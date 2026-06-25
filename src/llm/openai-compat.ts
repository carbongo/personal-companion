/**
 * OpenAI-compatible provider — works with OpenAI, OpenRouter, Groq, LM Studio,
 * vLLM, and anything else exposing POST {baseUrl}/chat/completions. Bring your
 * own `LLM_BASE_URL` + `LLM_API_KEY`. Images are sent in OpenAI's vision format
 * (data-URI image_url parts) for multimodal models.
 *
 * `LLM_THINK` effort levels (minimal|low|medium|high) map to the standard
 * `reasoning_effort` field, honored by reasoning models (OpenAI o-series/GPT-5,
 * and OpenRouter, which ignores it for models that don't reason). The boolean
 * true/false aren't sent — the OpenAI-style API has no universal on/off switch,
 * so they defer to the endpoint's default rather than risk a 400 on plain models.
 */
import type { LlmConfig } from "#/config/index.ts";
import {
	type ChatMessage,
	type GenerateOptions,
	type LLMProvider,
	type ProviderInfo,
	ProviderUnreachableError,
} from "./types.ts";

type OpenAIContent =
	| string
	| Array<
			| { type: "text"; text: string }
			| { type: "image_url"; image_url: { url: string } }
	  >;

interface OpenAIMessage {
	role: string;
	content: OpenAIContent;
}

export class OpenAICompatProvider implements LLMProvider {
	readonly name = "openai-compatible";

	constructor(private readonly cfg: LlmConfig) {}

	describe(): ProviderInfo {
		return {
			provider: "openai-compatible",
			model: this.cfg.model,
			endpoint: this.cfg.baseUrl,
		};
	}

	/** Hosted endpoints are assumed up; real errors surface on the chat call. */
	async reachable(): Promise<boolean> {
		return true;
	}

	/** Map LLM_THINK to a reasoning_effort, or null to leave it to the endpoint. */
	private reasoningEffort(override?: boolean | string): string | null {
		const raw = (override ?? this.cfg.think).toString().toLowerCase();
		if (
			raw === "minimal" ||
			raw === "low" ||
			raw === "medium" ||
			raw === "high"
		)
			return raw;
		return null; // "true" / "false" → endpoint default (no universal on/off)
	}

	private toMessage(m: ChatMessage): OpenAIMessage {
		if (!m.images?.length) return { role: m.role, content: m.content };
		const parts: Exclude<OpenAIContent, string> = [];
		if (m.content) parts.push({ type: "text", text: m.content });
		for (const b64 of m.images)
			parts.push({
				type: "image_url",
				image_url: { url: `data:image/jpeg;base64,${b64}` },
			});
		return { role: m.role, content: parts };
	}

	async chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string> {
		if (!this.cfg.baseUrl)
			throw new Error(
				"LLM_BASE_URL is required for the openai-compatible provider",
			);

		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
		if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;

		const effort = this.reasoningEffort(opts?.think);

		let res: Response;
		try {
			res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: this.cfg.model,
					messages: messages.map((m) => this.toMessage(m)),
					temperature: this.cfg.temperature,
					max_tokens: opts?.maxTokens ?? this.cfg.maxTokens,
					stream: false,
					...(effort ? { reasoning_effort: effort } : {}),
				}),
				signal: AbortSignal.timeout(this.cfg.timeoutMs),
			});
		} catch {
			throw new ProviderUnreachableError();
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`openai-compatible ${res.status}: ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		return (data.choices?.[0]?.message?.content ?? "").trim();
	}
}
