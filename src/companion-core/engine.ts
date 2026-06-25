/**
 * The engine — the channel- and provider-agnostic core. `respond(turn)` is the
 * one seam every channel calls: it loads memory, builds the prompt, generates a
 * reply (running any web lookups), persists the exchange, applies sidecar
 * actions, and returns the user-facing text. See docs/architecture.md.
 */
import { config } from "#/config/index.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import type { ChatMessage } from "#/llm/types.ts";
import { applyActions } from "./actions.ts";
import { buildKnowledge, buildVolatile } from "./context.ts";
import { appendMessage, messagesForDay, todayKey } from "./memory/store.ts";
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

/** Build one model reply, including the bounded web-lookup loop. */
async function generate(messages: ChatMessage[]): Promise<string> {
	let raw = await provider.chat(messages);
	if (!webConfigured()) return raw;
	for (let step = 0; step < config.web.steps; step++) {
		const reqs = extractWebRequests(raw);
		if (!reqs.length) break;
		const results = await runWebRequests(reqs);
		messages.push({ role: "assistant", content: raw });
		messages.push({
			role: "user",
			content:
				`[web results for you, not ${config.app.owner}'s words]\n${results}\n[end web results]\n\n` +
				"Now answer for real using what you found. Don't say you searched or paste raw links unless they help; just talk like you know.",
		});
		raw = await provider.chat(messages);
	}
	return raw;
}

export async function respond(turn: Turn): Promise<EngineReply> {
	const day = todayKey();
	const owner = config.app.owner;

	// Detect an unreachable model up front so the reply is quick. Persist the
	// incoming turn either way so it's caught up on a later turn / roll-up.
	if (!(await provider.reachable())) {
		persistUser(turn, day);
		return { reply: AWAY_MESSAGE };
	}

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
	const body = turn.text || (turn.images?.length ? "(sent a photo)" : "");
	const userMsg: ChatMessage = { role: "user", content: `${header}${body}` };
	if (turn.images?.length) userMsg.images = turn.images;
	messages.push(userMsg);

	let raw: string;
	try {
		raw = await generate(messages);
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
