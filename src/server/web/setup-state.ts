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
	// identity
	name: string;
	owner: string;
	preset: string;
	persona: string;
	// app
	timezone: string;
	dataDir: string;
	port: number;
	webAuthConfigured: boolean;
	// brain (LLM)
	provider: string;
	model: string;
	ollamaUrl: string;
	baseUrl: string;
	temperature: number;
	numCtx: number;
	maxTokens: number;
	think: string;
	timeoutMs: number;
	historyLimit: number;
	// Telegram
	telegramConfigured: boolean;
	telegramAllowedIds: string;
	telegramReplySplit: boolean;
	telegramBatchIdleMs: number;
	telegramBatchMaxMs: number;
	// memory
	memoryContextDays: number;
	memoryLimit: number;
	memoryNoteTitles: number;
	memorySummaryCron: string;
	// web access
	webEnabled: boolean;
	webSearchProvider: string;
	tavilyConfigured: boolean;
	webSteps: number;
	webResults: number;
	webPageChars: number;
	webSearchTimeoutMs: number;
	webFetchTimeoutMs: number;
	webMaxReqs: number;
	// speech-to-text
	sttProvider: string;
	sttApiUrl: string;
	sttConfigured: boolean;
	sttModel: string;
	sttLocalModel: string;
	sttLanguage: string;
	// weather
	weatherLat: string;
	weatherLon: string;
	weatherLocationName: string;
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
		timezone: config.app.timezone,
		dataDir: config.app.dataDir,
		port: config.app.port,
		webAuthConfigured: !!config.app.webAuthPassword,
		provider: config.llm.provider,
		model: config.llm.model,
		ollamaUrl: config.llm.ollamaUrl,
		baseUrl: config.llm.baseUrl,
		temperature: config.llm.temperature,
		numCtx: config.llm.numCtx,
		maxTokens: config.llm.maxTokens,
		think: config.llm.think,
		timeoutMs: config.llm.timeoutMs,
		historyLimit: config.llm.historyLimit,
		telegramConfigured: !!config.telegram.botToken,
		telegramAllowedIds: config.telegram.allowedUserIds.join(", "),
		telegramReplySplit: config.telegram.replySplit,
		telegramBatchIdleMs: config.telegram.batchIdleMs,
		telegramBatchMaxMs: config.telegram.batchMaxMs,
		memoryContextDays: config.memory.contextDays,
		memoryLimit: config.memory.memoryLimit,
		memoryNoteTitles: config.memory.noteTitles,
		memorySummaryCron: config.memory.summaryCron,
		webEnabled: config.web.enabled,
		webSearchProvider: config.web.searchProvider,
		tavilyConfigured: !!config.web.tavilyKey,
		webSteps: config.web.steps,
		webResults: config.web.results,
		webPageChars: config.web.pageChars,
		webSearchTimeoutMs: config.web.searchTimeoutMs,
		webFetchTimeoutMs: config.web.fetchTimeoutMs,
		webMaxReqs: config.web.maxRequestsPerStep,
		sttProvider: config.stt.provider,
		sttApiUrl: config.stt.apiUrl,
		sttConfigured: !!config.stt.apiKey,
		sttModel: config.stt.model,
		sttLocalModel: config.stt.localModel,
		sttLanguage: config.stt.language,
		weatherLat: config.weather.lat == null ? "" : String(config.weather.lat),
		weatherLon: config.weather.lon == null ? "" : String(config.weather.lon),
		weatherLocationName: config.weather.locationName,
	};
}
