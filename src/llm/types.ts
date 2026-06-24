/**
 * The LLM provider seam. Every model backend implements this one interface, so
 * the engine never knows which model is behind it. See
 * docs/decisions/llm-provider-abstraction.md.
 */

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
	/** base64-encoded image bytes (no data: prefix), for vision-capable models. */
	images?: string[];
}

export interface GenerateOptions {
	/** Override the configured max output tokens for this call. */
	maxTokens?: number;
	/** Reasoning: true | false | "low" | "medium" | "high". Provider may ignore. */
	think?: boolean | string;
}

export interface ProviderInfo {
	provider: string;
	model: string;
	endpoint?: string;
}

export interface LLMProvider {
	readonly name: string;
	/** Non-secret description for the UI / logs. */
	describe(): ProviderInfo;
	/** Fast liveness probe; hosted providers may just return true. */
	reachable(): Promise<boolean>;
	/** One generation. Returns the assistant text (may be empty). */
	chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string>;
}

/**
 * The model endpoint couldn't be reached (network error / timeout). Thrown so
 * callers can respond gently — e.g. a self-hosted model that is briefly down —
 * instead of surfacing a raw error.
 */
export class ProviderUnreachableError extends Error {
	constructor(message = "model endpoint unreachable") {
		super(message);
		this.name = "ProviderUnreachableError";
	}
}
