/**
 * The one way memory upkeep talks to the model. Summaries, reconciles, weekly
 * consolidation and digests are background work nobody waits on, so they can
 * run on a smaller, cheaper model (`MEMORY_MODEL`) than the conversation does —
 * on the same provider. Unset, they use the conversation's model.
 * See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import { provider } from "#/llm/index.ts";
import type { ChatMessage, GenerateOptions } from "#/llm/types.ts";

export function memoryChat(
	messages: ChatMessage[],
	opts: GenerateOptions = {},
): Promise<string> {
	const model = config.memory.model.trim();
	return provider.chat(messages, model ? { ...opts, model } : opts);
}
