/**
 * Ollama provider — a local model via Ollama's native /api/chat. The default,
 * privacy-first brain: no key, no external egress. Frugal by design (one
 * generation per turn; the engine keeps a stable cached system prefix so Ollama
 * reuses its KV cache). If reasoning eats the whole budget and the reply comes
 * back empty, we retry once with thinking off so an answer always comes back.
 */
import type { LlmConfig } from "#/config/index.ts";
import {
	type ChatMessage,
	type GenerateOptions,
	type LLMProvider,
	type ProviderInfo,
	ProviderUnreachableError,
	type StreamDelta,
} from "./types.ts";

interface OllamaMessage {
	role: string;
	content: string;
	images?: string[];
}

/** Cache of `${url}|${model}` → whether the model advertises vision, so the
 * capability is probed once per process rather than on every image turn. */
const visionCache = new Map<string, boolean>();

export class OllamaProvider implements LLMProvider {
	readonly name = "ollama";

	constructor(private readonly cfg: LlmConfig) {}

	describe(): ProviderInfo {
		return {
			provider: "ollama",
			model: this.cfg.model,
			endpoint: this.cfg.ollamaUrl,
		};
	}

	async reachable(): Promise<boolean> {
		try {
			const res = await fetch(`${this.cfg.ollamaUrl}/api/version`, {
				signal: AbortSignal.timeout(4000),
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	private thinkValue(override?: boolean | string): boolean | string {
		const raw = (override ?? this.cfg.think).toString().toLowerCase();
		if (raw === "true") return true;
		if (raw === "false") return false;
		return raw; // "low" | "medium" | "high" passthrough
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
		if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
		return headers;
	}

	private requestBody(
		model: string,
		messages: OllamaMessage[],
		think: boolean | string,
		numPredict: number,
		stream: boolean,
	): string {
		return JSON.stringify({
			model,
			messages,
			stream,
			think,
			options: {
				temperature: this.cfg.temperature,
				num_ctx: this.cfg.numCtx,
				num_predict: numPredict,
			},
		});
	}

	private async call(
		model: string,
		messages: OllamaMessage[],
		think: boolean | string,
		numPredict: number,
	): Promise<string> {
		let res: Response;
		try {
			res = await fetch(`${this.cfg.ollamaUrl}/api/chat`, {
				method: "POST",
				headers: this.headers(),
				body: this.requestBody(model, messages, think, numPredict, false),
				signal: AbortSignal.timeout(this.cfg.timeoutMs),
			});
		} catch {
			throw new ProviderUnreachableError();
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`ollama ${res.status}: ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as { message?: { content?: string } };
		return (data.message?.content ?? "").trim();
	}

	private toOllama(messages: ChatMessage[]): OllamaMessage[] {
		return messages.map((m) => ({
			role: m.role,
			content: m.content,
			...(m.images?.length ? { images: m.images } : {}),
		}));
	}

	async chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string> {
		const model = opts?.model?.trim() || this.cfg.model;
		const msgs = this.toOllama(messages);
		const numPredict = opts?.maxTokens ?? this.cfg.maxTokens;
		const think = this.thinkValue(opts?.think);
		let out = await this.call(model, msgs, think, numPredict);
		if (!out && think !== false)
			out = await this.call(model, msgs, false, numPredict);
		return out;
	}

	/**
	 * Stream a generation, calling `onDelta` with each content chunk. Ollama's
	 * /api/chat with stream:true returns one JSON object per line (NDJSON); we
	 * parse them as they arrive. If reasoning eats the whole budget and nothing
	 * comes back, we fall back once to a non-streamed call with thinking off so an
	 * answer always lands.
	 */
	async chatStream(
		messages: ChatMessage[],
		onDelta: StreamDelta,
		opts?: GenerateOptions,
	): Promise<string> {
		const model = opts?.model?.trim() || this.cfg.model;
		const msgs = this.toOllama(messages);
		const numPredict = opts?.maxTokens ?? this.cfg.maxTokens;
		const think = this.thinkValue(opts?.think);

		let res: Response;
		try {
			res = await fetch(`${this.cfg.ollamaUrl}/api/chat`, {
				method: "POST",
				headers: this.headers(),
				body: this.requestBody(model, msgs, think, numPredict, true),
				signal: AbortSignal.timeout(this.cfg.timeoutMs),
			});
		} catch {
			throw new ProviderUnreachableError();
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`ollama ${res.status}: ${body.slice(0, 200)}`);
		}
		if (!res.body) return this.chat(messages, opts);

		let full = "";
		let buf = "";
		const decoder = new TextDecoder();
		for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
			buf += decoder.decode(chunk, { stream: true });
			let nl: number;
			// biome-ignore lint/suspicious/noAssignInExpressions: line scan
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				let piece: string;
				try {
					const obj = JSON.parse(line) as { message?: { content?: string } };
					piece = obj.message?.content ?? "";
				} catch {
					continue;
				}
				if (piece) {
					full += piece;
					await onDelta(piece);
				}
			}
		}

		if (!full.trim() && think !== false) {
			const out = await this.call(model, msgs, false, numPredict);
			if (out) await onDelta(out);
			return out;
		}
		return full.trim();
	}

	/** Probe a model's `capabilities` via /api/show; true if it lists "vision". */
	async supportsVision(model?: string): Promise<boolean> {
		const name = model?.trim() || this.cfg.model;
		const key = `${this.cfg.ollamaUrl}|${name}`;
		const cached = visionCache.get(key);
		if (cached !== undefined) return cached;
		let ok = false;
		try {
			const res = await fetch(`${this.cfg.ollamaUrl}/api/show`, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify({ model: name }),
				signal: AbortSignal.timeout(6000),
			});
			if (res.ok) {
				const data = (await res.json()) as { capabilities?: string[] };
				ok = (data.capabilities ?? []).includes("vision");
			}
		} catch {
			ok = false;
		}
		visionCache.set(key, ok);
		return ok;
	}
}
