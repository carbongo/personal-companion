/**
 * The engine — the channel- and provider-agnostic core. `respond(turn)` is the
 * one seam every channel calls: it loads memory, builds the prompt, generates a
 * reply (running any web lookups), persists the exchange, applies sidecar
 * actions, and returns the user-facing text. `respondStream(turn, emit)` does the
 * same but emits the reply paragraph-by-paragraph as the model writes it, for the
 * web chat's live streaming. See docs/architecture.md.
 */
import { config } from "#/config/index.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import type { ChatMessage, GenerateOptions } from "#/llm/types.ts";
import { applyActions, parseActions } from "./actions.ts";
import { buildKnowledge, buildVolatile } from "./context.ts";
import { appendMessage, messagesForDay, todayKey } from "./memory/store.ts";
import { takeParagraphs } from "./paragraphs.ts";
import { buildIdentity, buildOperating } from "./persona.ts";
import {
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
}

export interface EngineReply {
	reply: string;
}

/** Called with each finished paragraph of a streamed reply. May be async. */
export type ParagraphSink = (paragraph: string) => void | Promise<void>;

const AWAY_MESSAGE =
	"I can't reach my model right now. Give me a moment and try me again.";

/** Whether a reply can be produced at all (a model endpoint is configured). */
export function companionConfigured(): boolean {
	if (config.llm.provider === "ollama") return !!config.llm.ollamaUrl;
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
		buildOperating({ web: webConfigured() }),
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
	const header = `[context for you, not ${owner}'s words]\n${volatile}\n[end context]\n\n`;
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
	return { messages, genOpts };
}

/** One non-streaming reply, including the bounded web-lookup loop. */
async function generate(
	messages: ChatMessage[],
	opts: GenerateOptions,
): Promise<string> {
	let raw = await provider.chat(messages, opts);
	if (!webConfigured()) return raw;
	for (let step = 0; step < config.web.steps; step++) {
		const reqs = extractWebRequests(raw);
		if (!reqs.length) break;
		const results = await runWebRequests(reqs);
		messages.push({ role: "assistant", content: raw });
		messages.push({ role: "user", content: webResultsMessage(results) });
		raw = await provider.chat(messages, opts);
	}
	return raw;
}

/** Strip sidecar + web tags from a chunk so only display text remains. */
function cleanForDisplay(text: string): string {
	return parseActions(stripWebTags(text)).cleaned;
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
	emit: ParagraphSink,
): Promise<string> {
	let buffer = "";
	const onDelta = async (delta: string): Promise<void> => {
		buffer += delta;
		const { paragraphs, rest } = takeParagraphs(buffer);
		buffer = rest;
		for (const p of paragraphs) {
			const cleaned = cleanForDisplay(p);
			if (cleaned) await emit(cleaned);
		}
	};
	const runOnce = (msgs: ChatMessage[]): Promise<string> =>
		provider.chatStream
			? provider.chatStream(msgs, onDelta, opts)
			: provider.chat(msgs, opts).then(async (full) => {
					await onDelta(full);
					return full;
				});

	let raw = await runOnce(messages);
	if (webConfigured()) {
		for (let step = 0; step < config.web.steps; step++) {
			const reqs = extractWebRequests(raw);
			if (!reqs.length) break;
			buffer = ""; // discard the web-tag-only partial before regenerating
			const results = await runWebRequests(reqs);
			messages.push({ role: "assistant", content: raw });
			messages.push({ role: "user", content: webResultsMessage(results) });
			raw = await runOnce(messages);
		}
	}
	// Flush the final generation's trailing paragraph (no blank line after it).
	const tail = cleanForDisplay(buffer);
	if (tail) await emit(tail);
	return raw;
}

export async function respond(turn: Turn): Promise<EngineReply> {
	const day = todayKey();

	// Detect an unreachable model up front so the reply is quick. Persist the
	// incoming turn either way so it's caught up on a later turn / roll-up.
	if (!(await provider.reachable())) {
		persistUser(turn, day);
		return { reply: AWAY_MESSAGE };
	}

	const { messages, genOpts } = await buildTurn(turn, day);

	let raw: string;
	try {
		raw = await generate(messages, genOpts);
	} catch (err) {
		if (err instanceof ProviderUnreachableError) {
			persistUser(turn, day);
			return { reply: AWAY_MESSAGE };
		}
		throw err;
	}

	persistUser(turn, day);
	const reply = applyActions(stripWebTags(raw)) || "…";
	appendMessage({ day, role: "assistant", content: reply });
	return { reply };
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
		await emit(AWAY_MESSAGE);
		return { reply: AWAY_MESSAGE };
	}

	const { messages, genOpts } = await buildTurn(turn, day);

	let emitted = 0;
	const sink: ParagraphSink = async (p) => {
		emitted++;
		await emit(p);
	};

	let raw: string;
	try {
		raw = await generateStream(messages, genOpts, sink);
	} catch (err) {
		if (err instanceof ProviderUnreachableError) {
			persistUser(turn, day);
			if (!emitted) await emit(AWAY_MESSAGE);
			return { reply: AWAY_MESSAGE };
		}
		throw err;
	}

	persistUser(turn, day);
	const reply = applyActions(stripWebTags(raw)) || "…";
	appendMessage({ day, role: "assistant", content: reply });
	// If nothing was streamable (e.g. the reply was only sidecar tags), still
	// hand the client the final text so a bubble always appears.
	if (!emitted) await emit(reply);
	return { reply };
}
