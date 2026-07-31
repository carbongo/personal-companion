/**
 * The engine — the channel- and provider-agnostic core. `respond(turn)` is the
 * one seam every channel calls: it loads memory, builds the prompt, generates a
 * reply (running any web lookups), persists the exchange, applies sidecar
 * actions, and returns the user-facing text. `respondStream(turn, emit)` does the
 * same but emits the reply paragraph-by-paragraph as the model writes it, for the
 * web chat's live streaming. See docs/architecture.md.
 */
import { synthesize, ttsConfigured } from "#/channels/tts.ts";
import { config } from "#/config/index.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import type { ChatMessage, GenerateOptions } from "#/llm/types.ts";
import { parseActions } from "./actions.ts";
import { buildKnowledge, buildVolatile } from "./context.ts";
import { buildConversationNote } from "./conversation.ts";
import { appendMessage, messagesForDay, todayKey } from "./memory/store.ts";
import { takeParagraphs } from "./paragraphs.ts";
import { buildIdentity, buildInterests, buildOperating } from "./persona.ts";
import {
	shouldSpeak,
	speakState,
	stripSpeakTags,
	wantsSpeak,
} from "./speak.ts";
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
async function buildTurn(
	turn: Turn,
	day: string,
): Promise<{ messages: ChatMessage[]; genOpts: GenerateOptions }> {
	const owner = config.app.owner;
	const history = messagesForDay(day);

	const system = [
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

	const messages: ChatMessage[] = [{ role: "system", content: system }];
	for (const m of history.slice(-config.llm.historyLimit))
		messages.push({ role: m.role, content: m.content });
	// The first non-system message must be a user turn.
	while (messages.length > 1 && messages[1]?.role === "assistant")
		messages.splice(1, 1);

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
): Promise<string> {
	let raw = await provider.chat(messages, opts);
	for (let i = 0; i < EMPTY_RETRIES && isBlankReply(raw); i++)
		raw = await provider.chat(messages, opts);
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
		return await synthesize(text);
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
): Promise<string> {
	let buffer = "";
	const onDelta = async (delta: string): Promise<void> => {
		buffer += delta;
		const { paragraphs, rest } = takeParagraphs(buffer);
		buffer = rest;
		for (const p of paragraphs) {
			const cleaned = cleanForDisplay(p);
			if (cleaned) await emit(cleaned, p);
		}
	};
	const draw = (msgs: ChatMessage[]): Promise<string> =>
		provider.chatStream
			? provider.chatStream(msgs, onDelta, opts)
			: provider.chat(msgs, opts).then(async (full) => {
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
	// Flush the final generation's trailing paragraph (no blank line after it).
	const tail = cleanForDisplay(buffer);
	if (tail) await emit(tail, buffer);
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
	if (cleaned) appendMessage({ day, role: "assistant", content: cleaned });
	// The reply goes back whole here, so the channel synthesizes it (if it can)
	// rather than the engine — the engine only says whether it should be spoken.
	const spoken = shouldSpeak(config.tts, {
		turnWasVoice: turn.kind === "voice",
		requestedVoice: turn.wantsVoice ?? false,
		modelWantsSpeak: wantsSpeak(raw),
	});
	return { reply: cleaned || "…", spoken };
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
	if (cleaned) appendMessage({ day, role: "assistant", content: cleaned });
	const reply = cleaned || "…";
	// If nothing was streamable (e.g. the reply was only sidecar tags), still
	// hand the client the final text so a bubble always appears.
	if (!emitted) await emit({ text: reply });
	return { reply, spoken };
}
