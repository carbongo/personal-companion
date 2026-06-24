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
} from "./types.ts";

interface OllamaMessage {
	role: string;
	content: string;
	images?: string[];
}

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

	private async call(
		messages: OllamaMessage[],
		think: boolean | string,
		numPredict: number,
	): Promise<string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
		if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;

		let res: Response;
		try {
			res = await fetch(`${this.cfg.ollamaUrl}/api/chat`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: this.cfg.model,
					messages,
					stream: false,
					think,
					options: {
						temperature: this.cfg.temperature,
						num_ctx: this.cfg.numCtx,
						num_predict: numPredict,
					},
				}),
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

	async chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string> {
		const msgs: OllamaMessage[] = messages.map((m) => ({
			role: m.role,
			content: m.content,
			...(m.images?.length ? { images: m.images } : {}),
		}));
		const numPredict = opts?.maxTokens ?? this.cfg.maxTokens;
		const think = this.thinkValue(opts?.think);
		let out = await this.call(msgs, think, numPredict);
		if (!out && think !== false) out = await this.call(msgs, false, numPredict);
		return out;
	}
}
