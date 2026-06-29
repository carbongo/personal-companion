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

/** Parse a comma/space-separated list of integers (e.g. an allowlist of IDs). */
function intList(key: string): number[] {
	const v = process.env[key];
	if (v == null || v === "") return [];
	return v
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map(Number)
		.filter((n) => Number.isFinite(n));
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
	/**
	 * Exit the process after a Settings save so a supervisor (launchd KeepAlive,
	 * Docker `restart:`, systemd `Restart=`) relaunches it with the new `.env`.
	 * Off by default — only safe when something actually supervises the process.
	 */
	autoRestartOnSave: boolean;
}

export type LlmProviderName = "ollama" | "openai-compatible" | "anthropic";

export interface LlmConfig {
	provider: LlmProviderName;
	model: string;
	/**
	 * Optional model used only for turns that include an image, when the main
	 * `model` can't see (e.g. a text-only local model). Empty = no dedicated
	 * vision model; image turns then fall back to the main model if it can see,
	 * or to an honest "I can't see images" reply if it can't.
	 */
	visionModel: string;
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

export interface TelegramConfig {
	/** BotFather token; empty disables the Telegram channel entirely. */
	botToken: string;
	/** Numeric Telegram user IDs allowed to talk to it; everyone else is ignored. */
	allowedUserIds: number[];
	/** Send a long reply as paragraph-sized messages, like a person texting. */
	replySplit: boolean;
}

/**
 * Conversation flow shared by every channel (web chat and Telegram): how a burst
 * of quick messages is folded into one turn. Both channels use the same window —
 * Telegram batches server-side, the web chat client-side — so these live here
 * rather than under any one channel.
 */
export interface ChatConfig {
	/** Idle window after the first message of a burst (ms). */
	batchIdleMs: number;
	/** How much the idle window grows with each further message (ms). */
	batchStepMs: number;
	/** Ceiling: the (growing) idle window never exceeds this (ms). */
	batchMaxMs: number;
}

export type SttProviderName = "off" | "openai" | "whisper-http" | "local";

export interface SttConfig {
	provider: SttProviderName;
	/** Full transcription endpoint URL (provider "whisper-http"). */
	apiUrl: string;
	apiKey: string;
	model: string;
	/** whisper.cpp CLI binary (provider "local"); resolved on PATH if bare. */
	localBin: string;
	/** Path to a ggml/gguf whisper model file (provider "local"). */
	localModel: string;
	/** ffmpeg binary used to normalize audio to 16 kHz mono wav (provider "local"). */
	ffmpegBin: string;
	/** Spoken-language hint, or "auto" to detect (provider "local"). */
	language: string;
}

export interface MemoryConfig {
	contextDays: number;
	memoryLimit: number;
	summaryCron: string;
	/**
	 * Whether the companion may manage its own memory mid-conversation via its
	 * sidecar tags (<remember>/<core>/<forget>). When false, those tags are not
	 * offered in the prompt and are ignored if emitted — memory becomes read-only,
	 * editable only by the owner from the UI. The nightly roll-up is unaffected.
	 */
	writesEnabled: boolean;
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
	chat: ChatConfig;
	telegram: TelegramConfig;
	stt: SttConfig;
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
			autoRestartOnSave: bool("AUTO_RESTART_ON_SAVE", false),
		},
		llm: {
			provider: str("LLM_PROVIDER", "ollama") as LlmProviderName,
			model: str("LLM_MODEL", "gemma4:12b"),
			visionModel: str("LLM_VISION_MODEL", ""),
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
		// Shared by web chat + Telegram. The idle window grows with each message up
		// to the ceiling (see ChatConfig). New CHAT_* names, falling back to the old
		// TELEGRAM_BATCH_* so existing .env files keep working unchanged.
		chat: {
			batchIdleMs: num(
				"CHAT_BATCH_IDLE_MS",
				num("TELEGRAM_BATCH_IDLE_MS", 3000),
			),
			batchStepMs: num("CHAT_BATCH_STEP_MS", 2000),
			batchMaxMs: num("CHAT_BATCH_MAX_MS", num("TELEGRAM_BATCH_MAX_MS", 12000)),
		},
		telegram: {
			botToken: str("TELEGRAM_BOT_TOKEN", ""),
			allowedUserIds: intList("TELEGRAM_ALLOWED_USER_IDS"),
			replySplit: bool("TELEGRAM_REPLY_SPLIT", true),
		},
		stt: {
			provider: str("STT_PROVIDER", "off") as SttProviderName,
			apiUrl: str("STT_API_URL", "").replace(/\/+$/, ""),
			apiKey: str("STT_API_KEY", ""),
			model: str("STT_MODEL", "whisper-1"),
			localBin: str("STT_LOCAL_BIN", "whisper-cli"),
			localModel: str("STT_LOCAL_MODEL", ""),
			ffmpegBin: str("STT_FFMPEG_BIN", "ffmpeg"),
			language: str("STT_LANGUAGE", "auto"),
		},
		memory: {
			contextDays: num("MEMORY_CONTEXT_DAYS", 7),
			memoryLimit: num("MEMORY_LIMIT", 40),
			summaryCron: str("MEMORY_SUMMARY_CRON", "55 23 * * *"),
			writesEnabled: bool("MEMORY_WRITES", true),
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
