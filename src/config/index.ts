/**
 * Configuration loading. Everything the app needs comes from the environment
 * (see `.env.example` for the full reference). This module is the single place
 * env is read, so the rest of the code takes a typed `config` object and never
 * touches `process.env` directly.
 */

function str(key: string, fallback: string): string {
	const v = process.env[key];
	return v == null || v === "" ? fallback : v;
}

function num(key: string, fallback: number): number {
	const v = process.env[key];
	if (v == null || v === "") return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
	const v = process.env[key];
	if (v == null || v === "") return fallback;
	return v.toLowerCase() !== "false";
}

/** Optional number: returns null when unset (distinguishes "0" from "absent"). */
function optNum(key: string): number | null {
	const v = process.env[key];
	if (v == null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export interface AppConfig {
	/** Display name the companion goes by (feeds the persona). */
	name: string;
	/** What the companion calls the owner. */
	owner: string;
	/** IANA timezone for day-bucketing, summaries, and the date it sees. */
	timezone: string;
	/** Directory holding the SQLite database and uploads (":memory:" for tests). */
	dataDir: string;
	/** Port for the web interface. */
	port: number;
	/** Web UI password; empty means no app-level auth (rely on a trusted network). */
	webAuthPassword: string;
}

export type LlmProviderName = "ollama" | "openai-compatible" | "anthropic";

export interface LlmConfig {
	provider: LlmProviderName;
	model: string;
	/** Local Ollama endpoint (provider "ollama"). */
	ollamaUrl: string;
	/** Base URL for hosted providers. */
	baseUrl: string;
	/** API key for hosted providers. */
	apiKey: string;
	temperature: number;
	numCtx: number;
	maxTokens: number;
	/** "true" | "false" | "low" | "medium" | "high". */
	think: string;
	timeoutMs: number;
	/** How many prior messages from the live day to send each turn. */
	historyLimit: number;
}

export interface MemoryConfig {
	contextDays: number;
	memoryLimit: number;
	noteTitles: number;
	summaryCron: string;
}

export interface WebConfig {
	enabled: boolean;
	searchProvider: "tavily" | "duckduckgo";
	tavilyKey: string;
	steps: number;
	results: number;
	pageChars: number;
	searchTimeoutMs: number;
	fetchTimeoutMs: number;
	maxRequestsPerStep: number;
}

export interface WeatherConfig {
	lat: number | null;
	lon: number | null;
	locationName: string;
}

export interface PersonaConfig {
	/** Which built-in preset to start from when no persona file is present. */
	preset: string;
}

export interface Config {
	app: AppConfig;
	llm: LlmConfig;
	memory: MemoryConfig;
	web: WebConfig;
	weather: WeatherConfig;
	persona: PersonaConfig;
}

export function loadConfig(): Config {
	return {
		app: {
			name: str("COMPANION_NAME", "Companion"),
			owner: str("COMPANION_OWNER", "friend"),
			timezone: str("TZ", "UTC"),
			dataDir: str("DATA_DIR", "./data"),
			port: num("PORT", 8080),
			webAuthPassword: str("WEB_AUTH_PASSWORD", ""),
		},
		llm: {
			provider: str("LLM_PROVIDER", "ollama") as LlmProviderName,
			model: str("LLM_MODEL", "gemma4:12b"),
			ollamaUrl: str("LLM_OLLAMA_URL", "http://localhost:11434").replace(
				/\/+$/,
				"",
			),
			baseUrl: str("LLM_BASE_URL", "").replace(/\/+$/, ""),
			apiKey: str("LLM_API_KEY", ""),
			temperature: num("LLM_TEMPERATURE", 0.7),
			numCtx: num("LLM_NUM_CTX", 8192),
			maxTokens: num("LLM_MAX_TOKENS", 1000),
			think: str("LLM_THINK", "true"),
			timeoutMs: num("LLM_TIMEOUT_MS", 120000),
			historyLimit: num("LLM_HISTORY_LIMIT", 60),
		},
		memory: {
			contextDays: num("MEMORY_CONTEXT_DAYS", 7),
			memoryLimit: num("MEMORY_LIMIT", 40),
			noteTitles: num("MEMORY_NOTE_TITLES", 12),
			summaryCron: str("MEMORY_SUMMARY_CRON", "55 23 * * *"),
		},
		web: {
			enabled: bool("WEB_ACCESS", true),
			searchProvider: str("WEB_SEARCH_PROVIDER", "duckduckgo") as
				| "tavily"
				| "duckduckgo",
			tavilyKey: str("TAVILY_API_KEY", ""),
			steps: num("WEB_STEPS", 3),
			results: num("WEB_RESULTS", 5),
			pageChars: num("WEB_PAGE_CHARS", 6000),
			searchTimeoutMs: num("WEB_SEARCH_TIMEOUT_MS", 12000),
			fetchTimeoutMs: num("WEB_FETCH_TIMEOUT_MS", 12000),
			maxRequestsPerStep: num("WEB_MAX_REQS", 3),
		},
		weather: {
			lat: optNum("WEATHER_LAT"),
			lon: optNum("WEATHER_LON"),
			locationName: str("WEATHER_LOCATION_NAME", ""),
		},
		persona: {
			preset: str("COMPANION_PRESET", "companion"),
		},
	};
}

export const config: Config = loadConfig();
