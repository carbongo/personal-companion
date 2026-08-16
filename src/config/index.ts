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

export type LlmProviderName =
	| "ollama"
	| "openai-compatible"
	| "claude-cli"
	| "anthropic";

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
	/**
	 * The `claude` binary (provider "claude-cli"); resolved on PATH if bare. The
	 * CLI brings its own auth, so that provider needs no key or URL.
	 */
	claudeBin: string;
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

export type TtsProviderName = "off" | "openai" | "http" | "local";

export interface TtsConfig {
	provider: TtsProviderName;
	/** Full speech-synthesis endpoint URL (provider "http"). */
	apiUrl: string;
	apiKey: string;
	model: string;
	/** Voice name/id passed to the hosted API (provider "openai" or "http"). */
	voice: string;
	/** Piper CLI binary (provider "local"); resolved on PATH if bare. */
	localBin: string;
	/** Path to a Piper .onnx voice model file (provider "local"). */
	localModel: string;
	/**
	 * When a reply is spoken. Three independent triggers (see
	 * companion-core/speak.ts): speak back when spoken to, speak when asked on
	 * the turn, and let the companion choose via its `<speak>` tag.
	 */
	speakMirror: boolean;
	speakOnRequest: boolean;
	speakSometimes: boolean;
}

export interface DiscordConfig {
	/** Bot token from the Discord developer portal; empty disables the channel. */
	botToken: string;
	/** Guild (server) the bot joins voice calls in. */
	guildId: string;
	/** Voice channel the bot listens/speaks in. */
	voiceChannelId: string;
	/** Discord user ID allowed to start/join a call; everyone else is ignored. */
	ownerUserId: string;
}

export type CallVadProviderName = "silero" | "energy" | "auto";

/**
 * Live voice calls (Phase 8): how speech is detected and turned into turns.
 * Mirrors the shape of SttConfig/TtsConfig — a provider knob plus its tuning —
 * but for the always-on streaming path rather than one-shot transcription.
 */
export interface CallConfig {
	/** Master switch; off means the call engine never starts even if Discord is set up. */
	enabled: boolean;
	/**
	 * Voice-activity-detection backend: "silero" (ONNX model, more accurate),
	 * "energy" (simple amplitude threshold, no model file needed), or "auto" to
	 * prefer Silero when its model is available and fall back to energy.
	 */
	vadProvider: CallVadProviderName;
	/** Speech-probability threshold above which audio counts as speech (0..1). */
	vadThreshold: number;
	/** Trailing silence (ms) that ends an utterance — the endpointing patience. */
	silenceMs: number;
	/** Hard cap (ms) on a single utterance, so a stuck-open mic can't run forever. */
	maxUtteranceMs: number;
	/** Whether the companion's own playback can be interrupted by new speech. */
	bargeIn: boolean;
	/** Utterances shorter than this (ms) are discarded as noise, not sent to STT. */
	minSpeechMs: number;
	/** Optional LLM override for call turns; empty = fall back to `llm.model`. */
	model: string;
	/** Optional LLM provider override for call turns; empty = fall back to `llm.provider`. */
	provider: string;
}

export interface MemoryConfig {
	contextDays: number;
	memoryLimit: number;
	summaryCron: string;
	/**
	 * Whether the nightly roll-up curates memory on its own: mining each day for
	 * durable facts to save (e.g. "{owner} works at a school as a software
	 * developer") and dropping ones the day made wrong. This is the only automatic
	 * memory management — the companion no longer writes memory mid-conversation.
	 * Off: the roll-up only writes the daily summary, and memory is yours to edit.
	 */
	rollupExtract: boolean;
	/**
	 * Whether a weekly pass also consolidates memory across the last week of daily
	 * summaries — strengthening recurring patterns into confident facts, merging
	 * near-duplicates, dropping one-offs, and fixing shifts the daily pass is too
	 * myopic to see. Gated by `rollupExtract` (it edits memory). Off: no weekly pass.
	 */
	weekly: boolean;
	/** When the weekly consolidation runs (5-field cron, in `TZ`). */
	weeklyCron: string;
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
	discord: DiscordConfig;
	call: CallConfig;
	stt: SttConfig;
	tts: TtsConfig;
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
			claudeBin: str("LLM_CLAUDE_BIN", "claude"),
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
		discord: {
			botToken: str("DISCORD_BOT_TOKEN", ""),
			guildId: str("DISCORD_GUILD_ID", ""),
			voiceChannelId: str("DISCORD_VOICE_CHANNEL_ID", ""),
			ownerUserId: str("DISCORD_OWNER_USER_ID", ""),
		},
		// Off by default: a live call needs Discord wired up and a VAD/STT/TTS
		// pipeline configured, so it stays opt-in even once the code exists.
		call: {
			enabled: bool("CALL_ENABLED", false),
			vadProvider: str("CALL_VAD_PROVIDER", "auto") as CallVadProviderName,
			vadThreshold: num("CALL_VAD_THRESHOLD", 0.5),
			silenceMs: num("CALL_SILENCE_MS", 700),
			maxUtteranceMs: num("CALL_MAX_UTTERANCE_MS", 30000),
			bargeIn: bool("CALL_BARGE_IN", true),
			minSpeechMs: num("CALL_MIN_SPEECH_MS", 200),
			model: str("CALL_MODEL", ""),
			provider: str("CALL_PROVIDER", ""),
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
		// Local (Piper) is the default: no network round-trip, matching the
		// project's local-first ethos and a latency priority. It stays gracefully
		// "unconfigured" until a voice model file is actually provided.
		tts: {
			provider: str("TTS_PROVIDER", "local") as TtsProviderName,
			apiUrl: str("TTS_API_URL", "").replace(/\/+$/, ""),
			apiKey: str("TTS_API_KEY", ""),
			model: str("TTS_MODEL", "tts-1"),
			voice: str("TTS_VOICE", ""),
			localBin: str("TTS_LOCAL_BIN", "piper"),
			localModel: str("TTS_LOCAL_MODEL", ""),
			// Mirroring and asking are the unsurprising triggers: audio only ever
			// answers audio, or an explicit request. Letting the companion speak
			// up on its own stays off until it's wanted.
			speakMirror: bool("TTS_SPEAK_MIRROR", true),
			speakOnRequest: bool("TTS_SPEAK_ON_REQUEST", true),
			speakSometimes: bool("TTS_SPEAK_SOMETIMES", false),
		},
		memory: {
			contextDays: num("MEMORY_CONTEXT_DAYS", 7),
			memoryLimit: num("MEMORY_LIMIT", 40),
			summaryCron: str("MEMORY_SUMMARY_CRON", "55 23 * * *"),
			rollupExtract: bool("MEMORY_ROLLUP_EXTRACT", true),
			weekly: bool("MEMORY_WEEKLY", true),
			// Monday 04:00 — after the week's last daily roll-up, a quiet hour.
			weeklyCron: str("MEMORY_WEEKLY_CRON", "0 4 * * 1"),
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

/**
 * Whether the Discord channel is set up enough to join a voice call: a bot
 * token plus knowing which guild and channel to sit in. Mirrors how
 * `telegramConfigured()` gates on `config.telegram.botToken` alone — Discord
 * needs the extra IDs because "join a voice channel" isn't implicit the way
 * "answer any DM" is for a bot token.
 */
export function discordConfigured(): boolean {
	const { botToken, guildId, voiceChannelId } = config.discord;
	return !!botToken && !!guildId && !!voiceChannelId;
}

/**
 * Resolve the model/provider a call turn actually uses: a dedicated
 * `CALL_MODEL`/`CALL_PROVIDER` override when set, otherwise the base `llm`
 * config — the same "dedicated override, else the main model" fallback the
 * vision model uses (see `visionPlan` in companion-core/engine.ts).
 */
export function resolveCallModel(): {
	provider: LlmProviderName;
	model: string;
} {
	return {
		provider: (config.call.provider || config.llm.provider) as LlmProviderName,
		model: config.call.model || config.llm.model,
	};
}
