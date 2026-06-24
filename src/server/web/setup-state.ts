/**
 * First-run detection and the non-secret values used to prefill the setup
 * wizard. Setup is "complete" once the wizard has been saved at least once;
 * before then, the web root redirects to /setup. Secrets (API keys, the
 * Telegram token) are never echoed back to the page — only whether they are set.
 */
import { getSetting } from "#/companion-core/memory/store.ts";
import { config } from "#/config/index.ts";

export function isSetupComplete(): boolean {
	return getSetting("setup_complete") === "1";
}

export interface SetupValues {
	name: string;
	owner: string;
	preset: string;
	persona: string;
	provider: string;
	model: string;
	ollamaUrl: string;
	baseUrl: string;
	telegramConfigured: boolean;
}

/** Current configuration to seed the wizard fields (no secrets). */
export function currentSetupValues(): SetupValues {
	return {
		name: config.app.name,
		owner: config.app.owner,
		preset: config.persona.preset,
		persona: getSetting("persona") ?? "",
		provider: config.llm.provider,
		model: config.llm.model,
		ollamaUrl: config.llm.ollamaUrl,
		baseUrl: config.llm.baseUrl,
		telegramConfigured: !!config.telegram.botToken,
	};
}
