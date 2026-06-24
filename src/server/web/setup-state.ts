/**
 * First-run detection and the non-secret values used to prefill the setup
 * wizard. Setup is "complete" once the wizard has been saved at least once;
 * before then, the web root redirects to /setup. Secrets (API keys, the
 * Telegram token) are never echoed back to the page — only whether they are set.
 */
import { existsSync, readFileSync } from "node:fs";

import { getSetting } from "#/companion-core/memory/store.ts";
import { config } from "#/config/index.ts";

const PERSONA_FILE = "persona/persona.md";

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
	telegramAllowedIds: string;
}

/**
 * The persona text to show in the editor: the saved override if there is one,
 * otherwise the contents of the `persona/persona.md` file (the same file the
 * engine falls back to), so an existing persona is visible and editable rather
 * than appearing blank.
 */
function effectivePersona(): string {
	const setting = getSetting("persona");
	if (setting?.trim()) return setting;
	if (existsSync(PERSONA_FILE)) {
		try {
			return readFileSync(PERSONA_FILE, "utf8");
		} catch {
			// fall through to empty
		}
	}
	return "";
}

/** Current configuration to seed the wizard fields (no secrets). */
export function currentSetupValues(): SetupValues {
	return {
		name: config.app.name,
		owner: config.app.owner,
		preset: config.persona.preset,
		persona: effectivePersona(),
		provider: config.llm.provider,
		model: config.llm.model,
		ollamaUrl: config.llm.ollamaUrl,
		baseUrl: config.llm.baseUrl,
		telegramConfigured: !!config.telegram.botToken,
		telegramAllowedIds: config.telegram.allowedUserIds.join(", "),
	};
}
