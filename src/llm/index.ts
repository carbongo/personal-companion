/**
 * Provider selection. Returns the configured LLM backend behind the common
 * `LLMProvider` interface, so the engine stays provider-agnostic. See
 * docs/decisions/llm-provider-abstraction.md.
 */
import { config, type LlmConfig } from "#/config/index.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";
import type { LLMProvider } from "./types.ts";

export function createProvider(cfg: LlmConfig = config.llm): LLMProvider {
	switch (cfg.provider) {
		case "ollama":
			return new OllamaProvider(cfg);
		case "openai-compatible":
			return new OpenAICompatProvider(cfg);
		case "anthropic":
			// Native Anthropic lands in a later increment. Anthropic models are
			// reachable today via the openai-compatible provider (e.g. through an
			// OpenAI-compatible gateway such as OpenRouter).
			throw new Error(
				'LLM_PROVIDER="anthropic" is not implemented yet — use "openai-compatible" with an Anthropic-compatible gateway, or "ollama".',
			);
		default:
			throw new Error(`Unknown LLM_PROVIDER: ${cfg.provider}`);
	}
}

/** The process-wide provider. */
export const provider: LLMProvider = createProvider();

export type { LLMProvider } from "./types.ts";
export { ProviderUnreachableError } from "./types.ts";
