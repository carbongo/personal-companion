/**
 * JSON API behind the web interface. Thin handlers over the engine and the
 * memory store: the built-in browser chat (`/chat`, `/messages`), the memory
 * admin (`/core`, `/memories`, `/summaries`, `/rollup`), and the setup wizard
 * (`/setup/test`, `/setup`). Auth (when enabled) is applied upstream in
 * ./index.ts. See docs/channels.md and docs/configuration.md.
 */
import { Hono } from "hono";
import { sttConfigured, transcribe } from "#/channels/stt.ts";
import { telegramConfigured } from "#/channels/telegram/index.ts";
import { companionConfigured, respond } from "#/companion-core/engine.ts";
import { saveUpload, sniffImageExt } from "#/companion-core/media.ts";
import { runDailyRollup } from "#/companion-core/memory/rollup.ts";
import {
	addMemory,
	deleteMemory,
	getCore,
	listDailySummaries,
	messagesForDay,
	searchMemories,
	setCore,
	setSetting,
	todayKey,
} from "#/companion-core/memory/store.ts";
import {
	config,
	type LlmConfig,
	type LlmProviderName,
} from "#/config/index.ts";
import { createProvider, provider } from "#/llm/index.ts";
import { webAuthEnabled } from "./auth.ts";
import { writeEnvFile } from "./env-file.ts";
import { currentSetupValues, isSetupComplete } from "./setup-state.ts";

interface SetupBody {
	// identity
	name?: string;
	owner?: string;
	preset?: string;
	persona?: string;
	coreSeed?: string;
	// app
	timezone?: string;
	dataDir?: string;
	port?: string;
	webAuthPassword?: string;
	autoRestartOnSave?: string;
	// brain (LLM)
	provider?: string;
	model?: string;
	ollamaUrl?: string;
	baseUrl?: string;
	apiKey?: string;
	temperature?: string;
	numCtx?: string;
	maxTokens?: string;
	think?: string;
	timeoutMs?: string;
	historyLimit?: string;
	// chat (shared by web + Telegram)
	chatBatchIdleMs?: string;
	chatBatchStepMs?: string;
	chatBatchMaxMs?: string;
	// Telegram
	telegramToken?: string;
	telegramAllowedIds?: string;
	telegramReplySplit?: string;
	// memory
	memoryContextDays?: string;
	memoryLimit?: string;
	memorySummaryCron?: string;
	// web access
	webEnabled?: string;
	webSearchProvider?: string;
	tavilyKey?: string;
	webSteps?: string;
	webResults?: string;
	webPageChars?: string;
	webSearchTimeoutMs?: string;
	webFetchTimeoutMs?: string;
	webMaxReqs?: string;
	// speech-to-text
	sttProvider?: string;
	sttApiUrl?: string;
	sttApiKey?: string;
	sttModel?: string;
	sttLocalModel?: string;
	sttLanguage?: string;
	// weather
	weatherLat?: string;
	weatherLon?: string;
	weatherLocationName?: string;
}

const trimEnd = (s: string) => s.replace(/\/+$/, "");

/** Build a one-off provider config from posted wizard values (for the test). */
function mergedLlmConfig(b: SetupBody): LlmConfig {
	return {
		...config.llm,
		provider: (b.provider as LlmProviderName) || config.llm.provider,
		model: b.model?.trim() || config.llm.model,
		ollamaUrl: trimEnd(b.ollamaUrl?.trim() || config.llm.ollamaUrl),
		baseUrl: trimEnd(b.baseUrl?.trim() || config.llm.baseUrl),
		apiKey: b.apiKey || config.llm.apiKey,
		// Keep the wizard responsive — a real generation shouldn't hang the page.
		timeoutMs: 20000,
	};
}

export const api = new Hono();

// --- state -------------------------------------------------------------------

api.get("/state", (c) => {
	const brain = provider.describe();
	return c.json({
		setupComplete: isSetupComplete(),
		app: {
			name: config.app.name,
			owner: config.app.owner,
			timezone: config.app.timezone,
		},
		brain,
		companionConfigured: companionConfigured(),
		channels: { telegram: telegramConfigured() },
		web: { enabled: config.web.enabled },
		// Whether the interface is password-gated — the SPA shows a "seal" (logout).
		auth: { enabled: webAuthEnabled() },
		// So the browser chat behaves like Telegram: the same burst-batching
		// window, and whether voice notes can be transcribed.
		chat: {
			batchIdleMs: config.chat.batchIdleMs,
			batchStepMs: config.chat.batchStepMs,
			batchMaxMs: config.chat.batchMaxMs,
			voice: sttConfigured(),
		},
	});
});

// --- built-in browser chat ---------------------------------------------------

api.get("/messages", (c) => {
	const day = todayKey();
	const messages = messagesForDay(day).map((m) => ({
		id: m.id,
		role: m.role,
		kind: m.kind,
		content: m.content,
		// Attachments saved for the turn, so the history redisplays them.
		mediaUrls: m.mediaUrl ? m.mediaUrl.split("\n").filter(Boolean) : [],
		createdAt: m.createdAt,
	}));
	return c.json({ day, messages });
});

api.post("/chat", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		text?: string;
		images?: string[];
		kind?: "text" | "voice" | "photo";
	};
	const text = (body.text ?? "").trim();
	// base64 image data (no data: prefix), one entry per attached image.
	const images = Array.isArray(body.images)
		? body.images.filter((s) => typeof s === "string" && s.length > 0)
		: [];
	if (!text && !images.length)
		return c.json({ error: "text or an image is required" }, 400);
	if (!companionConfigured())
		return c.json({ error: "No model is configured yet. Visit Setup." }, 503);
	const kind = images.length ? "photo" : (body.kind ?? "text");
	// Persist the attachments so the history can show them back (served by the
	// /uploads route); the base64 still rides along to the model this turn.
	let mediaUrl: string | null = null;
	if (images.length) {
		const urls: string[] = [];
		for (const b64 of images) {
			const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
			const url = await saveUpload(bytes, sniffImageExt(bytes));
			if (url) urls.push(url);
		}
		mediaUrl = urls.length ? urls.join("\n") : null;
	}
	try {
		const { reply } = await respond({
			text,
			images: images.length ? images : undefined,
			kind,
			mediaUrl,
		});
		return c.json({ reply });
	} catch (err) {
		return c.json({ error: (err as Error).message }, 500);
	}
});

// Transcribe an uploaded/recorded voice note to text, so the browser chat can
// send voice the way Telegram does. Shares one STT backend with every channel.
api.post("/transcribe", async (c) => {
	if (!sttConfigured())
		return c.json(
			{ error: "Voice isn't set up. Configure speech-to-text in Settings." },
			503,
		);
	let bytes: Uint8Array;
	let filename = "voice.webm";
	try {
		const form = await c.req.parseBody();
		const file = form.file;
		if (!(file instanceof File)) return c.json({ error: "no audio file" }, 400);
		filename = file.name || filename;
		bytes = new Uint8Array(await file.arrayBuffer());
	} catch {
		return c.json({ error: "could not read the audio" }, 400);
	}
	if (!bytes.length) return c.json({ error: "empty audio" }, 400);
	try {
		const text = await transcribe(bytes, filename);
		return c.json({ text });
	} catch (err) {
		return c.json({ error: (err as Error).message }, 500);
	}
});

// Geocode a place name for the Settings location picker. Proxied through the
// server (not the browser) so egress stays server-side and consistent with the
// weather provider — both use Open-Meteo, keyless. Auth-gated like the rest of
// /api. Failures degrade to an empty list, never an error.
api.get("/geocode", async (c) => {
	const q = (c.req.query("q") ?? "").trim();
	if (q.length < 2) return c.json({ results: [] });
	const url =
		"https://geocoding-api.open-meteo.com/v1/search" +
		`?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return c.json({ results: [] });
		const data = (await res.json()) as {
			results?: Array<{
				name?: string;
				admin1?: string;
				country?: string;
				latitude?: number;
				longitude?: number;
				timezone?: string;
			}>;
		};
		const results = (data.results ?? [])
			.filter((r) => typeof r.latitude === "number")
			.map((r) => ({
				name: r.name ?? "",
				admin1: r.admin1 ?? "",
				country: r.country ?? "",
				latitude: r.latitude as number,
				longitude: r.longitude as number,
				timezone: r.timezone ?? "",
			}));
		return c.json({ results });
	} catch {
		return c.json({ results: [] });
	}
});

// --- memory admin ------------------------------------------------------------

api.get("/core", (c) => c.json({ contentMd: getCore() }));

api.put("/core", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { contentMd?: string };
	setCore(body.contentMd ?? "");
	return c.json({ ok: true });
});

api.get("/memories", (c) => {
	const q = c.req.query("q") ?? "";
	return c.json({ memories: searchMemories(q, 200) });
});

api.post("/memories", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		content?: string;
		tags?: string | null;
	};
	const content = (body.content ?? "").trim();
	if (!content) return c.json({ error: "content is required" }, 400);
	return c.json({ memory: addMemory(content, body.tags ?? null) }, 201);
});

api.delete("/memories/:id", (c) => {
	const id = Number(c.req.param("id"));
	if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
	deleteMemory(id);
	return c.json({ ok: true });
});

api.get("/summaries", (c) => c.json({ summaries: listDailySummaries(120) }));

api.post("/rollup", async (c) => {
	try {
		const summarized = await runDailyRollup();
		return c.json({ summarized });
	} catch (err) {
		return c.json({ error: (err as Error).message }, 500);
	}
});

// --- setup wizard ------------------------------------------------------------

api.get("/setup", (c) =>
	c.json({ setupComplete: isSetupComplete(), values: currentSetupValues() }),
);

api.post("/setup/test", async (c) => {
	const b = (await c.req.json().catch(() => ({}))) as SetupBody;
	if (b.provider === "anthropic")
		return c.json({
			ok: false,
			detail:
				'The native "anthropic" provider is not implemented yet — use "openai-compatible" with an Anthropic-compatible gateway, or "ollama".',
		});
	let test: ReturnType<typeof createProvider>;
	try {
		test = createProvider(mergedLlmConfig(b));
	} catch (err) {
		return c.json({ ok: false, detail: (err as Error).message });
	}
	if (!(await test.reachable()))
		return c.json({
			ok: false,
			detail:
				"Couldn't reach the model endpoint. Check the URL and that it's running.",
		});
	try {
		const reply = await test.chat(
			[{ role: "user", content: "Reply with the single word: ok" }],
			{ think: false, maxTokens: 16 },
		);
		return c.json({
			ok: true,
			detail: `Connected — the model replied: "${reply.slice(0, 60) || "(empty)"}"`,
		});
	} catch (err) {
		return c.json({ ok: false, detail: (err as Error).message });
	}
});

api.post("/setup", async (c) => {
	const b = (await c.req.json().catch(() => ({}))) as SetupBody;

	// A blank optional field is left untouched (never clobbers an existing value);
	// selects and numbers always carry a value, so they are always written.
	const opt = (s?: string) => (s?.trim() ? s.trim() : undefined);

	const providerName = (b.provider as LlmProviderName) || config.llm.provider;
	const env: Record<string, string | undefined> = {
		COMPANION_NAME: opt(b.name),
		COMPANION_OWNER: opt(b.owner),
		COMPANION_PRESET: opt(b.preset),
		TZ: opt(b.timezone),
		DATA_DIR: opt(b.dataDir),
		PORT: opt(b.port),
		AUTO_RESTART_ON_SAVE: opt(b.autoRestartOnSave),
		LLM_PROVIDER: providerName,
		LLM_MODEL: opt(b.model),
		LLM_TEMPERATURE: opt(b.temperature),
		LLM_NUM_CTX: opt(b.numCtx),
		LLM_MAX_TOKENS: opt(b.maxTokens),
		LLM_THINK: opt(b.think),
		LLM_TIMEOUT_MS: opt(b.timeoutMs),
		LLM_HISTORY_LIMIT: opt(b.historyLimit),
		TELEGRAM_ALLOWED_USER_IDS: opt(b.telegramAllowedIds),
		TELEGRAM_REPLY_SPLIT: opt(b.telegramReplySplit),
		CHAT_BATCH_IDLE_MS: opt(b.chatBatchIdleMs),
		CHAT_BATCH_STEP_MS: opt(b.chatBatchStepMs),
		CHAT_BATCH_MAX_MS: opt(b.chatBatchMaxMs),
		MEMORY_CONTEXT_DAYS: opt(b.memoryContextDays),
		MEMORY_LIMIT: opt(b.memoryLimit),
		MEMORY_SUMMARY_CRON: opt(b.memorySummaryCron),
		WEB_ACCESS: opt(b.webEnabled),
		WEB_SEARCH_PROVIDER: opt(b.webSearchProvider),
		WEB_STEPS: opt(b.webSteps),
		WEB_RESULTS: opt(b.webResults),
		WEB_PAGE_CHARS: opt(b.webPageChars),
		WEB_SEARCH_TIMEOUT_MS: opt(b.webSearchTimeoutMs),
		WEB_FETCH_TIMEOUT_MS: opt(b.webFetchTimeoutMs),
		WEB_MAX_REQS: opt(b.webMaxReqs),
		STT_PROVIDER: opt(b.sttProvider),
		STT_API_URL: opt(b.sttApiUrl),
		STT_MODEL: opt(b.sttModel),
		STT_LOCAL_MODEL: opt(b.sttLocalModel),
		STT_LANGUAGE: opt(b.sttLanguage),
		WEATHER_LAT: opt(b.weatherLat),
		WEATHER_LON: opt(b.weatherLon),
		WEATHER_LOCATION_NAME: opt(b.weatherLocationName),
	};
	if (providerName === "ollama") {
		env.LLM_OLLAMA_URL = trimEnd(b.ollamaUrl?.trim() ?? "") || undefined;
	} else {
		env.LLM_BASE_URL = trimEnd(b.baseUrl?.trim() ?? "") || undefined;
		if (b.apiKey) env.LLM_API_KEY = b.apiKey;
	}
	// Secrets are only written when actually re-entered, so saving never wipes an
	// existing one that the page (which never echoes secrets) couldn't show back.
	if (b.telegramToken?.trim()) env.TELEGRAM_BOT_TOKEN = b.telegramToken.trim();
	if (b.webAuthPassword) env.WEB_AUTH_PASSWORD = b.webAuthPassword;
	if (b.tavilyKey) env.TAVILY_API_KEY = b.tavilyKey;
	if (b.sttApiKey) env.STT_API_KEY = b.sttApiKey;

	try {
		writeEnvFile(".env", env);
	} catch (err) {
		return c.json(
			{ error: `Couldn't write .env: ${(err as Error).message}` },
			500,
		);
	}

	// Persona and Core apply live (the engine reads them from the DB each turn):
	// a custom persona overrides the preset; an empty one falls back to the preset.
	setSetting("persona", b.persona?.trim() ?? "");
	if (b.coreSeed?.trim()) setCore(b.coreSeed.trim());
	setSetting("setup_complete", "1");

	// Optionally relaunch so the new .env takes effect with no manual step. The
	// process just exits; a supervisor (launchd KeepAlive, Docker, systemd) brings
	// it back with the fresh config. We use the value as just saved, so enabling it
	// takes effect on this very save. Exit is delayed so this response flushes first.
	const restarting =
		(b.autoRestartOnSave ??
			(config.app.autoRestartOnSave ? "true" : "false")) === "true";
	if (restarting) {
		console.log("[companion] settings saved — restarting to apply (.env)…");
		setTimeout(() => process.exit(0), 700);
	}

	return c.json({ ok: true, restartNeeded: true, restarting });
});
