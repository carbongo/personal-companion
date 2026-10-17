/**
 * The engine — the channel- and provider-agnostic core. `respond(turn)` is the
 * one seam every channel calls: it loads memory, builds the prompt, generates a
 * reply (running any web lookups), persists the exchange, applies sidecar
 * actions, and returns the user-facing text. `respondStream(turn, emit)` does the
 * same but emits the reply paragraph-by-paragraph as the model writes it, for the
 * web chat's live streaming. See docs/architecture.md.
 */
import { synthesize, ttsConfigured } from "#/channels/tts.ts";
import { config, resolveCallModel } from "#/config/index.ts";
import type { Message } from "#/db/schema.ts";
import {
	createProvider,
	type LLMProvider,
	ProviderUnreachableError,
	provider,
} from "#/llm/index.ts";
import type { ChatMessage, GenerateOptions } from "#/llm/types.ts";
import { parseActions } from "./actions.ts";
import { takeClauses } from "./clauses.ts";
import { buildKnowledge, buildVolatile } from "./context.ts";
import { buildConversationNote } from "./conversation.ts";
import {
	appendMessage,
	lastMessageBefore,
	messagesForDay,
	todayKey,
} from "./memory/store.ts";
import { takeParagraphs } from "./paragraphs.ts";
import { buildIdentity, buildInterests, buildOperating } from "./persona.ts";
import {
	sanitizeForSpeech,
	shouldSpeak,
	speakState,
	stripSpeakTags,
	wantsSpeak,
} from "./speak.ts";
import { markGaps, spanLabel } from "./time.ts";
import {
	extractUrls,
	extractWebRequests,
	runWebRequests,
	stripWebTags,
	webConfigured,
} from "./web.ts";

/** One channel-neutral unit of input. */
export interface Turn {
	/** The user's message text (a channel may clump a burst into one). */
	text: string;
	/** base64 image bytes (no data: prefix), for vision-capable models. */
	images?: string[];
	/** How the input arrived, for the stored log. */
	kind?: "text" | "voice" | "photo";
	/** One or more `/uploads/…` paths (newline-separated) for saved attachments. */
	mediaUrl?: string | null;
	/**
	 * The owner asked for this reply to be spoken (a channel's voice toggle or
	 * command). Absent means no such request — never that speaking is off.
	 */
	wantsVoice?: boolean;
}

export interface EngineReply {
	reply: string;
	/**
	 * Whether this reply should be said out loud (see ./speak.ts). The streaming
	 * path already synthesized it per paragraph; a channel that takes the reply
	 * whole (Telegram) uses this to decide whether to synthesize it itself.
	 */
	spoken: boolean;
	/**
	 * The id of the logged assistant row, when one was written. A channel that
	 * saved audio for the reply uses it to point that row at the clips (see
	 * `setMessageMedia`); absent when the reply was blank and never stored.
	 */
	messageId?: number;
}

/** One finished paragraph of a streamed reply. */
export interface ParagraphChunk {
	/** The user-facing text, all sidecar tags removed. */
	text: string;
	/** Synthesized speech for this paragraph, when the turn is being spoken. */
	audio?: Uint8Array;
}

/** Called with each finished paragraph of a streamed reply. May be async. */
export type ParagraphSink = (chunk: ParagraphChunk) => void | Promise<void>;

/**
 * Called with each finished clause of a streamed reply. Text only: a live call
 * synthesizes and plays each clause itself, so the engine hands over the words
 * and stays out of the audio path.
 */
export type ClauseSink = (text: string) => void | Promise<void>;

/**
 * How a streamed reply is cut up. Paragraphs are right for chat and voice notes;
 * a call needs clauses, because waiting for a paragraph is half a second of
 * silence the owner can hear. `flush` means the stream has ended — nothing more
 * is coming to disambiguate the tail.
 */
type Splitter = (
	buffer: string,
	flush: boolean,
) => { chunks: string[]; rest: string };

const paragraphSplitter: Splitter = (buffer, flush) => {
	if (flush) return { chunks: buffer ? [buffer] : [], rest: "" };
	const { paragraphs, rest } = takeParagraphs(buffer);
	return { chunks: paragraphs, rest };
};

const clauseSplitter: Splitter = (buffer, flush) => {
	const { clauses, rest } = takeClauses(buffer, { flush });
	return { chunks: clauses, rest };
};

/**
 * Internal: like `ParagraphSink`, but also handed the paragraph's raw text with
 * its tags intact, so the caller can see whether the model asked for it to be
 * spoken before deciding to synthesize.
 */
type DraftSink = (cleaned: string, raw: string) => void | Promise<void>;

const AWAY_MESSAGE =
	"I can't reach my model right now. Give me a moment and try me again.";

/** Whether a reply can be produced at all (a model endpoint is configured). */
export function companionConfigured(): boolean {
	if (config.llm.provider === "ollama") return !!config.llm.ollamaUrl;
	// claude-cli has no endpoint to point at — the brain is a binary on this box.
	if (config.llm.provider === "claude-cli") return !!config.llm.claudeBin;
	return !!config.llm.baseUrl;
}

/** What gets written to the log for an incoming turn. */
function persistedContent(turn: Turn): string {
	if (turn.text) return turn.text;
	if (turn.images?.length) return "(sent a photo)";
	return "";
}

function persistUser(turn: Turn, day: string): void {
	appendMessage({
		day,
		role: "user",
		kind: turn.kind ?? "text",
		content: persistedContent(turn),
		mediaUrl: turn.mediaUrl ?? null,
	});
}

/**
 * How an image turn is handled: which model generates it, and whether the image
 * can actually be seen. A dedicated `LLM_VISION_MODEL` (when set) takes the turn;
 * otherwise the main model is used if it advertises vision; if neither can see,
 * the image is dropped and the companion is told to say so honestly rather than
 * guess (which is how it used to "recall" an unrelated image).
 */
async function visionPlan(
	turn: Turn,
): Promise<{ model?: string; canSee: boolean }> {
	if (!turn.images?.length) return { canSee: true };
	const visionModel = config.llm.visionModel?.trim();
	if (visionModel) return { model: visionModel, canSee: true };
	const canSee = provider.supportsVision
		? await provider.supportsVision()
		: true;
	return { canSee };
}

/**
 * Collapse consecutive same-role turns so history strictly alternates. Some chat
 * templates (Gemma's included) return nothing when two user turns sit back to
 * back — which now happens whenever a turn produced no stored reply (an empty
 * draw is shown as "…" but never logged). Merging keeps the model answering.
 */
function alternate(messages: ChatMessage[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (const m of messages) {
		const prev = out[out.length - 1];
		if (prev && prev.role === m.role && m.role !== "system") {
			prev.content = `${prev.content}\n\n${m.content}`.trim();
			if (m.images?.length) prev.images = [...(prev.images ?? []), ...m.images];
		} else {
			out.push({ ...m });
		}
	}
	return out;
}

/** The framing for web-lookup results fed back into the model. */
function webResultsMessage(results: string): string {
	return (
		`[web results for you, not ${config.app.owner}'s words]\n${results}\n[end web results]\n\n` +
		"Now answer for real using what you found. Don't say you searched or paste raw links unless they help; just talk like you know."
	);
}

/**
 * Build the message list and per-call options for a turn — shared by the
 * streaming and non-streaming paths. Handles history, the volatile context
 * header, and image/vision routing.
 */
/** What the companion is told, before it reads the day: who it is, how this
 * works, and everything it remembers. */
function buildSystem(): string {
	return [
		buildIdentity(),
		buildInterests(),
		buildOperating({
			web: webConfigured(),
			autoMemory: config.memory.rollupExtract,
		}),
		buildKnowledge(),
	]
		.filter((s) => s.trim())
		.join("\n\n")
		.trim();
}

/** Stands in for the owner's turn when the day opens with the companion's own
 * message — it wrote first (see ./reach-out.ts). */
export const WROTE_FIRST = "[you messaged first]";

/** The system prompt plus the day so far, ready for the next user turn. */
function buildHistory(history: Message[]): ChatMessage[] {
	const messages: ChatMessage[] = [{ role: "system", content: buildSystem() }];
	// A message that came after a pause carries a "[3 hours later]" marker, so a
	// pause inside the day reads as one. Derived from timestamps on every turn and
	// never stored, so the history the model sees stays deterministic.
	const shown = history.slice(-config.llm.historyLimit);
	const first = shown[0];
	const marked = markGaps(
		shown,
		first ? lastMessageBefore(first.createdAt) : null,
	);
	shown.forEach((m, i) => {
		messages.push({ role: m.role, content: marked[i] ?? m.content });
	});
	// The first non-system message must be a user turn. A whole day that opens
	// with the companion's message is one it wrote first, and it has to stay
	// visible — otherwise the owner's reply would answer something it can't see.
	// A history cut by the limit just loses its leading assistant turns.
	if (messages[1]?.role === "assistant" && shown.length === history.length)
		messages.splice(1, 0, { role: "user", content: WROTE_FIRST });
	while (messages.length > 1 && messages[1]?.role === "assistant")
		messages.splice(1, 1);
	return messages;
}

async function buildTurn(
	turn: Turn,
	day: string,
): Promise<{ messages: ChatMessage[]; genOpts: GenerateOptions }> {
	const owner = config.app.owner;
	const history = messagesForDay(day);
	const messages = buildHistory(history);

	const volatile = await buildVolatile();
	// The movement note rides on this turn only, like the volatile context — it
	// describes the last few exchanges, so it must never harden into the history.
	const note = buildConversationNote(history);
	const header =
		`[context for you, not ${owner}'s words]\n${volatile}\n[end context]\n\n` +
		(note ? `${note}\n\n` : "");
	const plan = await visionPlan(turn);
	const body = turn.text || (turn.images?.length ? "(sent a photo)" : "");
	const userMsg: ChatMessage = { role: "user", content: `${header}${body}` };
	if (turn.images?.length) {
		if (plan.canSee) {
			userMsg.images = turn.images;
		} else {
			userMsg.content =
				`${header}${turn.text ? `${turn.text}\n\n` : ""}` +
				`[${owner} attached an image, but your current model can't see images. Tell ${owner} plainly you can't view it — never pretend to see it or guess what it shows.]`;
		}
	}
	messages.push(userMsg);

	const genOpts: GenerateOptions = {};
	if (plan.model) genOpts.model = plan.model;
	// Image turns answer directly: thinking + vision is flaky on local models (it
	// can burn the whole budget and return nothing) and a picture rarely needs
	// deliberation. This also avoids a 400 on a vision model that can't "think".
	if (turn.images?.length && plan.canSee) genOpts.think = false;
	return { messages: alternate(messages), genOpts };
}

/**
 * How many times to re-ask the model when a draw comes back wholly empty. Small
 * quantized models at higher temperature occasionally sample the stop token first
 * and return nothing; a fresh draw almost always yields real text. A reply that
 * carries a web tag isn't empty — it's work to run — so it's never retried.
 */
const EMPTY_RETRIES = 2;

/** True when a draw has no user-visible text and no web request to run. */
function isBlankReply(raw: string): boolean {
	if (extractWebRequests(raw).length) return false;
	return !cleanForDisplay(raw);
}

/** One model call, re-drawn a couple of times if it returns nothing. */
async function chatNonEmpty(
	messages: ChatMessage[],
	opts: GenerateOptions,
	llm: LLMProvider = provider,
): Promise<string> {
	let raw = await llm.chat(messages, opts);
	for (let i = 0; i < EMPTY_RETRIES && isBlankReply(raw); i++)
		raw = await llm.chat(messages, opts);
	return raw;
}

/** Links the owner actually sent, so a mangled `<fetch>` can be snapped back to
 * the real URL. Collected before the web loop, while every turn is still real. */
function userUrls(messages: ChatMessage[]): string[] {
	const out: string[] = [];
	for (const m of messages)
		if (m.role === "user")
			for (const u of extractUrls(m.content)) if (!out.includes(u)) out.push(u);
	return out;
}

/** One non-streaming reply, including the bounded web-lookup loop. */
async function generate(
	messages: ChatMessage[],
	opts: GenerateOptions,
): Promise<string> {
	const urls = userUrls(messages);
	let raw = await chatNonEmpty(messages, opts);
	if (!webConfigured()) return raw;
	for (let step = 0; step < config.web.steps; step++) {
		const reqs = extractWebRequests(raw);
		if (!reqs.length) break;
		const results = await runWebRequests(reqs, urls);
		messages.push({ role: "assistant", content: raw });
		messages.push({ role: "user", content: webResultsMessage(results) });
		raw = await chatNonEmpty(messages, opts);
	}
	return raw;
}

/** Strip sidecar + web tags from a chunk so only display text remains. */
function cleanForDisplay(text: string): string {
	return commitActions(stripWebTags(text));
}

/**
 * Strip any memory sidecar tags from the reply before it's shown or stored. The
 * companion no longer manages memory mid-conversation (that lives in the nightly
 * roll-up), so the tags are never acted on — only removed, in case a reply emits
 * a stray one, so it never leaks to the user.
 *
 * The `<speak>` markers come off here too — the words inside are ordinary reply
 * text and stay, only the request to say them out loud is consumed.
 */
function commitActions(raw: string): string {
	return parseActions(stripSpeakTags(raw)).cleaned;
}

/**
 * Synthesize a paragraph, best-effort. A backend that's missing, slow, or
 * unhappy must never cost the owner the reply itself, so a failure degrades to
 * text exactly as if speaking were off.
 */
async function speakAloud(text: string): Promise<Uint8Array | undefined> {
	if (!ttsConfigured()) return undefined;
	try {
		return await synthesize(sanitizeForSpeech(text));
	} catch (err) {
		console.error("[companion] tts failed:", (err as Error).message);
		return undefined;
	}
}

/**
 * One streamed reply: emits each finished paragraph (tags stripped) via `emit`
 * as it lands, runs the same web-lookup loop, and returns the full raw text of
 * the final generation for persistence + sidecar actions. Web-lookup steps emit
 * nothing (their output is a bare tag), so only the real answer is shown.
 */
async function generateStream(
	messages: ChatMessage[],
	opts: GenerateOptions,
	emit: DraftSink,
	split: Splitter = paragraphSplitter,
	llm: LLMProvider = provider,
): Promise<string> {
	let buffer = "";
	const onDelta = async (delta: string): Promise<void> => {
		buffer += delta;
		const { chunks, rest } = split(buffer, false);
		buffer = rest;
		for (const p of chunks) {
			const cleaned = cleanForDisplay(p);
			if (cleaned) await emit(cleaned, p);
		}
	};
	const draw = (msgs: ChatMessage[]): Promise<string> =>
		llm.chatStream
			? llm.chatStream(msgs, onDelta, opts)
			: llm.chat(msgs, opts).then(async (full) => {
					await onDelta(full);
					return full;
				});
	// Re-draw a wholly empty stream (nothing shown, nothing buffered, no web tag).
	const runOnce = async (msgs: ChatMessage[]): Promise<string> => {
		let out = await draw(msgs);
		for (
			let i = 0;
			i < EMPTY_RETRIES && isBlankReply(out) && !buffer.trim();
			i++
		)
			out = await draw(msgs);
		return out;
	};

	const urls = userUrls(messages);
	let raw = await runOnce(messages);
	if (webConfigured()) {
		for (let step = 0; step < config.web.steps; step++) {
			const reqs = extractWebRequests(raw);
			if (!reqs.length) break;
			buffer = ""; // discard the web-tag-only partial before regenerating
			const results = await runWebRequests(reqs, urls);
			messages.push({ role: "assistant", content: raw });
			messages.push({ role: "user", content: webResultsMessage(results) });
			raw = await runOnce(messages);
		}
	}
	// Flush what the final generation left buffered (a trailing paragraph has no
	// blank line after it; a trailing clause has no boundary after it).
	const { chunks: tail } = split(buffer, true);
	for (const p of tail) {
		const cleaned = cleanForDisplay(p);
		if (cleaned) await emit(cleaned, p);
	}
	return raw;
}

export async function respond(turn: Turn): Promise<EngineReply> {
	const day = todayKey();

	// Detect an unreachable model up front so the reply is quick. Persist the
	// incoming turn either way so it's caught up on a later turn / roll-up.
	if (!(await provider.reachable())) {
		persistUser(turn, day);
		return { reply: AWAY_MESSAGE, spoken: false };
	}

	const { messages, genOpts } = await buildTurn(turn, day);
	// Persist the incoming turn now — after the history was read for the prompt,
	// before generation — so it's logged even if generation fails, and so a
	// concurrent reader sees it without waiting for the reply.
	persistUser(turn, day);

	let raw: string;
	try {
		raw = await generate(messages, genOpts);
	} catch (err) {
		if (err instanceof ProviderUnreachableError)
			return { reply: AWAY_MESSAGE, spoken: false };
		throw err;
	}

	// Only a real reply is logged. A blank draw is shown as "…" but never stored:
	// a stored "…" turn gets mimicked, seeding a run of empty replies for the day.
	const cleaned = commitActions(stripWebTags(raw));
	const row = cleaned
		? appendMessage({ day, role: "assistant", content: cleaned })
		: undefined;
	// The reply goes back whole here, so the channel synthesizes it (if it can)
	// rather than the engine — the engine only says whether it should be spoken.
	const spoken = shouldSpeak(config.tts, {
		turnWasVoice: turn.kind === "voice",
		requestedVoice: turn.wantsVoice ?? false,
		modelWantsSpeak: wantsSpeak(raw),
	});
	return { reply: cleaned || "…", spoken, messageId: row?.id };
}

/**
 * Like `respond`, but streams the reply: `emit` is called with each finished
 * paragraph as the model writes it. Returns the full reply once done (already
 * persisted, with sidecar actions applied). Used by the web chat.
 */
export async function respondStream(
	turn: Turn,
	emit: ParagraphSink,
): Promise<EngineReply> {
	const day = todayKey();

	if (!(await provider.reachable())) {
		persistUser(turn, day);
		await emit({ text: AWAY_MESSAGE });
		return { reply: AWAY_MESSAGE, spoken: false };
	}

	const { messages, genOpts } = await buildTurn(turn, day);
	// Persist the incoming turn now — after the history was read for the prompt,
	// before the (possibly long) generation — so a browser that reloads mid-reply
	// still sees the message it just sent rather than losing it.
	persistUser(turn, day);

	let emitted = 0;
	let spoken = false;
	// A `<speak>` passage can span paragraphs, so its open/closed state is carried
	// from one chunk to the next (see ./speak.ts).
	let speakOpen = false;
	const sink: DraftSink = async (text, draft) => {
		emitted++;
		const state = speakState(draft, speakOpen);
		speakOpen = state.open;
		const say = shouldSpeak(config.tts, {
			turnWasVoice: turn.kind === "voice",
			requestedVoice: turn.wantsVoice ?? false,
			modelWantsSpeak: state.speak,
		});
		// Synthesized here, paragraph by paragraph, so audio starts playing while
		// the model is still writing the rest.
		const audio = say ? await speakAloud(text) : undefined;
		if (audio) spoken = true;
		await emit(audio ? { text, audio } : { text });
	};

	let raw: string;
	try {
		raw = await generateStream(messages, genOpts, sink);
	} catch (err) {
		if (err instanceof ProviderUnreachableError) {
			if (!emitted) await emit({ text: AWAY_MESSAGE });
			return { reply: AWAY_MESSAGE, spoken: false };
		}
		throw err;
	}

	// Only a real reply is logged; a blank "…" is shown but never stored (a stored
	// "…" turn gets mimicked, seeding a run of empty replies for the day).
	const cleaned = commitActions(stripWebTags(raw));
	const row = cleaned
		? appendMessage({ day, role: "assistant", content: cleaned })
		: undefined;
	const reply = cleaned || "…";
	// If nothing was streamable (e.g. the reply was only sidecar tags), still
	// hand the client the final text so a bubble always appears.
	if (!emitted) await emit({ text: reply });
	return { reply, spoken, messageId: row?.id };
}

/** Memo for a call-only backend, so a call doesn't rebuild its provider per turn. */
let callLlm: { key: string; llm: LLMProvider } | null = null;

/**
 * The backend a call turn runs on. A call can point at a smaller, faster model
 * (`CALL_MODEL` / `CALL_PROVIDER`) so the first words come back within a beat
 * while chat keeps the larger one; with neither set this is the process-wide
 * provider, unchanged.
 */
function callProvider(): { llm: LLMProvider; model: string } {
	const { provider: name, model } = resolveCallModel();
	if (name === config.llm.provider) return { llm: provider, model };
	const key = `${name}:${model}`;
	if (callLlm?.key !== key)
		callLlm = {
			key,
			llm: createProvider({ ...config.llm, provider: name, model }),
		};
	return { llm: callLlm.llm, model };
}

/**
 * Like `respondStream`, but cut at clause boundaries and without synthesizing
 * anything: a live call speaks each clause as it lands, so audio starts long
 * before the model has finished the reply. The paragraph path is untouched —
 * the web chat and Telegram voice notes still call `respondStream`.
 *
 * The reply is logged as a `voice` message, so the roll-up reads a call the same
 * way it reads a voice note. Barge-in truncation is the caller's job: only the
 * session knows which clauses were actually heard (see call/session.ts).
 */
export async function respondClauses(
	turn: Turn,
	emit: ClauseSink,
): Promise<EngineReply> {
	const day = todayKey();
	const { llm, model } = callProvider();

	if (!(await llm.reachable())) {
		persistUser(turn, day);
		await emit(AWAY_MESSAGE);
		return { reply: AWAY_MESSAGE, spoken: false };
	}

	const { messages, genOpts } = await buildTurn(turn, day);
	if (model) genOpts.model = model;
	// Persisted after the history was read for the prompt, before generation —
	// the same order as the other two paths, for the same reasons.
	persistUser(turn, day);

	let emitted = 0;
	const sink: DraftSink = async (text) => {
		emitted++;
		await emit(text);
	};

	let raw: string;
	try {
		raw = await generateStream(messages, genOpts, sink, clauseSplitter, llm);
	} catch (err) {
		if (err instanceof ProviderUnreachableError) {
			if (!emitted) await emit(AWAY_MESSAGE);
			return { reply: AWAY_MESSAGE, spoken: false };
		}
		throw err;
	}

	const cleaned = commitActions(stripWebTags(raw));
	const row = cleaned
		? appendMessage({ day, role: "assistant", kind: "voice", content: cleaned })
		: undefined;
	const reply = cleaned || "…";
	if (!emitted) await emit(reply);
	// A call is spoken by definition; what was *heard* is a separate question the
	// session answers by truncating the stored reply after a barge-in.
	return { reply, spoken: true, messageId: row?.id };
}

/** A message the companion decided to send first (see ./reach-out.ts). */
export interface ReachOutDraft {
	text: string;
	/** It asked for this to be said out loud — sent as a voice note if it can be. */
	spoken: boolean;
}

/** The reply that means "no real reason to write right now". */
const PASS = /<pass\s*\/?>/i;

function reachOutPrompt(silenceMs: number): string {
	const owner = config.app.owner;
	return `[a moment to yourself — nobody wrote to you; this is not ${owner}'s words]
It's been ${spanLabel(silenceMs)} since you two last talked. You're deciding whether to message ${owner} first, the way a close friend sometimes does.

Only write if there's a real reason you'd actually text them about right now: something they were going through or had coming up that should have happened by now (ask how it went), something you remember that today brushes against, something from what you're into that made you think of them, or simply that it's been long enough that you miss them. Not a check-in for its own sake, not a list of questions, not guilt about the quiet.

If you write: one short message, the way you'd really text — a single thought, at most one question. If it's the kind of thing you'd rather say out loud, like a quick call, wrap it in <speak>…</speak> and it goes as a voice note.
If there's no real reason right now, reply with exactly <pass/> and nothing else.
[end]`;
}

/**
 * Ask the companion whether it has a real reason to write first and, if so,
 * what it would say. Nothing is stored here: the prompt is a private moment, not
 * a turn, and the message only enters the log once a channel has delivered it
 * (`logReachOut`). Returns null for a pass, or when the model is unreachable.
 */
export async function draftReachOut(
	silenceMs: number,
): Promise<ReachOutDraft | null> {
	if (!(await provider.reachable())) return null;
	const messages = buildHistory(messagesForDay(todayKey()));
	const volatile = await buildVolatile();
	messages.push({
		role: "user",
		content: `[context for you, not ${config.app.owner}'s words]\n${volatile}\n[end context]\n\n${reachOutPrompt(silenceMs)}`,
	});
	let raw: string;
	try {
		raw = await generate(alternate(messages), {});
	} catch (err) {
		if (err instanceof ProviderUnreachableError) return null;
		throw err;
	}
	if (PASS.test(raw)) return null;
	const text = commitActions(stripWebTags(raw));
	if (!text) return null;
	return { text, spoken: wantsSpeak(raw) && ttsConfigured() };
}

/** Log a delivered first message as the companion's turn — it really was said. */
export function logReachOut(
	draft: ReachOutDraft,
	kind: "text" | "voice",
): void {
	appendMessage({
		day: todayKey(),
		role: "assistant",
		kind,
		content: draft.text,
	});
}
