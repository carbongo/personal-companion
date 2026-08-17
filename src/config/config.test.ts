import { describe, expect, it } from "bun:test";

import {
	config,
	discordConfigured,
	loadConfig,
	resolveCallModel,
	resolveLocalVoice,
} from "./index.ts";

describe("loadConfig", () => {
	it("provides safe defaults with an empty environment", () => {
		const prev = { ...process.env };
		for (const k of ["COMPANION_NAME", "COMPANION_OWNER", "TZ", "PORT"])
			delete process.env[k];

		const { app } = loadConfig();
		expect(app.name).toBe("Companion");
		expect(app.owner).toBe("friend");
		expect(app.timezone).toBe("UTC");
		expect(app.port).toBe(8080);

		process.env = prev;
	});

	it("reads overrides and coerces the port to a number", () => {
		const prev = { ...process.env };
		process.env.COMPANION_NAME = "Sage";
		process.env.PORT = "9000";

		const { app } = loadConfig();
		expect(app.name).toBe("Sage");
		expect(app.port).toBe(9000);

		process.env = prev;
	});

	it("parses the Telegram allowlist into numbers, ignoring junk", () => {
		const prev = { ...process.env };
		process.env.TELEGRAM_ALLOWED_USER_IDS = "111, 222  333,,x,444";

		const { telegram } = loadConfig();
		expect(telegram.allowedUserIds).toEqual([111, 222, 333, 444]);

		process.env = prev;
	});

	it("defaults the Telegram channel off with sane batch knobs", () => {
		const prev = { ...process.env };
		for (const k of [
			"TELEGRAM_BOT_TOKEN",
			"TELEGRAM_ALLOWED_USER_IDS",
			"STT_PROVIDER",
			"CHAT_BATCH_IDLE_MS",
			"CHAT_BATCH_STEP_MS",
			"CHAT_BATCH_MAX_MS",
			"TELEGRAM_BATCH_IDLE_MS",
			"TELEGRAM_BATCH_MAX_MS",
		])
			delete process.env[k];

		const { telegram, chat, stt } = loadConfig();
		expect(telegram.botToken).toBe("");
		expect(telegram.allowedUserIds).toEqual([]);
		expect(telegram.replySplit).toBe(true);
		expect(chat.batchIdleMs).toBe(3000);
		expect(chat.batchStepMs).toBe(2000);
		expect(chat.batchMaxMs).toBe(12000);
		expect(stt.provider).toBe("off");

		process.env = prev;
	});

	it("reads chat batch knobs, with the old TELEGRAM_BATCH_* as a fallback", () => {
		const prev = { ...process.env };

		// New CHAT_* names win.
		delete process.env.TELEGRAM_BATCH_IDLE_MS;
		process.env.CHAT_BATCH_IDLE_MS = "6000";
		process.env.CHAT_BATCH_STEP_MS = "1500";
		process.env.CHAT_BATCH_MAX_MS = "25000";
		let chat = loadConfig().chat;
		expect(chat.batchIdleMs).toBe(6000);
		expect(chat.batchStepMs).toBe(1500);
		expect(chat.batchMaxMs).toBe(25000);

		// With CHAT_* unset, the legacy TELEGRAM_BATCH_* still applies (step defaults).
		delete process.env.CHAT_BATCH_IDLE_MS;
		delete process.env.CHAT_BATCH_STEP_MS;
		delete process.env.CHAT_BATCH_MAX_MS;
		process.env.TELEGRAM_BATCH_IDLE_MS = "4000";
		process.env.TELEGRAM_BATCH_MAX_MS = "20000";
		chat = loadConfig().chat;
		expect(chat.batchIdleMs).toBe(4000);
		expect(chat.batchStepMs).toBe(2000);
		expect(chat.batchMaxMs).toBe(20000);

		process.env = prev;
	});
});

describe("discord + call config", () => {
	it("defaults everything off/empty with sane call knobs", () => {
		const prev = { ...process.env };
		for (const k of [
			"DISCORD_BOT_TOKEN",
			"DISCORD_GUILD_ID",
			"DISCORD_VOICE_CHANNEL_ID",
			"DISCORD_OWNER_USER_ID",
			"CALL_ENABLED",
			"CALL_PROVIDER",
			"CALL_MODEL",
			"CALL_VAD_PROVIDER",
			"CALL_VAD_THRESHOLD",
			"CALL_SILENCE_MS",
			"CALL_MAX_UTTERANCE_MS",
			"CALL_BARGE_IN",
			"CALL_MIN_SPEECH_MS",
		])
			delete process.env[k];

		const { discord, call } = loadConfig();
		expect(discord.botToken).toBe("");
		expect(discord.guildId).toBe("");
		expect(discord.voiceChannelId).toBe("");
		expect(discord.ownerUserId).toBe("");
		expect(call.enabled).toBe(false);
		expect(call.vadProvider).toBe("auto");
		expect(call.vadThreshold).toBe(0.5);
		expect(call.silenceMs).toBe(700);
		expect(call.maxUtteranceMs).toBe(30000);
		expect(call.bargeIn).toBe(true);
		expect(call.minSpeechMs).toBe(200);
		expect(call.model).toBe("");
		expect(call.provider).toBe("");

		process.env = prev;
	});

	it("parses the numeric and boolean call knobs from the environment", () => {
		const prev = { ...process.env };
		process.env.DISCORD_BOT_TOKEN = "test-token";
		process.env.DISCORD_GUILD_ID = "111";
		process.env.DISCORD_VOICE_CHANNEL_ID = "222";
		process.env.CALL_ENABLED = "true";
		process.env.CALL_VAD_PROVIDER = "energy";
		process.env.CALL_VAD_THRESHOLD = "0.8";
		process.env.CALL_SILENCE_MS = "500";
		process.env.CALL_MAX_UTTERANCE_MS = "15000";
		process.env.CALL_BARGE_IN = "false";
		process.env.CALL_MIN_SPEECH_MS = "150";

		const { discord, call } = loadConfig();
		expect(discord.botToken).toBe("test-token");
		expect(discord.guildId).toBe("111");
		expect(discord.voiceChannelId).toBe("222");
		expect(call.enabled).toBe(true);
		expect(call.vadProvider).toBe("energy");
		expect(call.vadThreshold).toBe(0.8);
		expect(call.silenceMs).toBe(500);
		expect(call.maxUtteranceMs).toBe(15000);
		expect(call.bargeIn).toBe(false);
		expect(call.minSpeechMs).toBe(150);

		process.env = prev;
	});
});

describe("STT/TTS/call quality config", () => {
	it("defaults the new STT knobs", () => {
		const prev = { ...process.env };
		for (const k of [
			"STT_DETECT_MODEL",
			"STT_LANGUAGES",
			"STT_NO_SPEECH_THRESHOLD",
			"STT_MIN_CLIP_MS",
			"STT_ENTROPY_THRESHOLD",
			"STT_LOGPROB_THRESHOLD",
		])
			delete process.env[k];

		const { stt } = loadConfig();
		expect(stt.detectModel).toBe("");
		expect(stt.languages).toEqual([]);
		expect(stt.noSpeechThreshold).toBe(0.6);
		expect(stt.minClipMs).toBe(400);
		expect(stt.entropyThreshold).toBe(2.4);
		expect(stt.logprobThreshold).toBe(-1.0);

		process.env = prev;
	});

	it("parses STT_LANGUAGES into a trimmed string list, ignoring junk entries", () => {
		const prev = { ...process.env };
		process.env.STT_LANGUAGES = "en, ru  ,, ,de";

		const { stt } = loadConfig();
		expect(stt.languages).toEqual(["en", "ru", "de"]);

		process.env = prev;
	});

	it("reads the new STT thresholds and detect model from the environment", () => {
		const prev = { ...process.env };
		process.env.STT_DETECT_MODEL = "./data/models/detect.bin";
		process.env.STT_NO_SPEECH_THRESHOLD = "0.8";
		process.env.STT_MIN_CLIP_MS = "600";
		process.env.STT_ENTROPY_THRESHOLD = "3.1";
		process.env.STT_LOGPROB_THRESHOLD = "-0.5";

		const { stt } = loadConfig();
		expect(stt.detectModel).toBe("./data/models/detect.bin");
		expect(stt.noSpeechThreshold).toBe(0.8);
		expect(stt.minClipMs).toBe(600);
		expect(stt.entropyThreshold).toBe(3.1);
		expect(stt.logprobThreshold).toBe(-0.5);

		process.env = prev;
	});

	it("defaults the TTS local voice map to empty, with resolveLocalVoice falling back", () => {
		const prev = { ...process.env };
		delete process.env.TTS_LOCAL_MODEL_MAP;
		process.env.TTS_LOCAL_MODEL = "./data/models/en.onnx";

		const { tts } = loadConfig();
		expect(tts.localModelByLang).toEqual({});

		process.env = prev;
	});

	it("parses TTS_LOCAL_MODEL_MAP into a per-language record, skipping malformed entries", () => {
		const prev = { ...process.env };
		process.env.TTS_LOCAL_MODEL_MAP =
			"en=./data/models/en.onnx,ru=./data/models/ru.onnx,badentry,noval=,=novakey,  ,de = ./data/models/de.onnx ";

		const { tts } = loadConfig();
		expect(tts.localModelByLang).toEqual({
			en: "./data/models/en.onnx",
			ru: "./data/models/ru.onnx",
			de: "./data/models/de.onnx",
		});

		process.env = prev;
	});

	it("defaults the call endpointing patience knobs", () => {
		const prev = { ...process.env };
		for (const k of [
			"CALL_PATIENCE_MS",
			"CALL_PATIENCE_EXTENDED_MS",
			"CALL_PATIENCE_MAX_MS",
		])
			delete process.env[k];

		const { call } = loadConfig();
		expect(call.patienceMs).toBe(900);
		expect(call.patienceExtendedMs).toBe(2000);
		expect(call.patienceMaxMs).toBe(3500);

		process.env = prev;
	});

	it("reads the call endpointing patience knobs from the environment", () => {
		const prev = { ...process.env };
		process.env.CALL_PATIENCE_MS = "1000";
		process.env.CALL_PATIENCE_EXTENDED_MS = "2500";
		process.env.CALL_PATIENCE_MAX_MS = "4000";

		const { call } = loadConfig();
		expect(call.patienceMs).toBe(1000);
		expect(call.patienceExtendedMs).toBe(2500);
		expect(call.patienceMaxMs).toBe(4000);

		process.env = prev;
	});
});

describe("resolveLocalVoice", () => {
	it("uses the per-language map entry when present, else the global fallback", () => {
		const original = { ...config.tts };

		config.tts.localModel = "./data/models/fallback.onnx";
		config.tts.localModelByLang = { en: "./data/models/en.onnx" };
		expect(resolveLocalVoice("en")).toBe("./data/models/en.onnx");
		expect(resolveLocalVoice("ru")).toBe("./data/models/fallback.onnx");

		Object.assign(config.tts, original);
	});
});

describe("discordConfigured", () => {
	it("needs a bot token, guild, and voice channel all set", () => {
		const original = { ...config.discord };

		config.discord.botToken = "";
		config.discord.guildId = "";
		config.discord.voiceChannelId = "";
		expect(discordConfigured()).toBe(false);

		config.discord.botToken = "test-token";
		expect(discordConfigured()).toBe(false); // still missing guild/channel

		config.discord.guildId = "111";
		config.discord.voiceChannelId = "222";
		expect(discordConfigured()).toBe(true);

		Object.assign(config.discord, original);
	});
});

describe("resolveCallModel", () => {
	it("falls back to the base llm config when no call override is set", () => {
		const original = { ...config.call };

		config.call.provider = "";
		config.call.model = "";
		expect(resolveCallModel()).toEqual({
			provider: config.llm.provider,
			model: config.llm.model,
		});

		Object.assign(config.call, original);
	});

	it("uses the dedicated call override when set", () => {
		const original = { ...config.call };

		config.call.provider = "openai-compatible";
		config.call.model = "call-model";
		expect(resolveCallModel()).toEqual({
			provider: "openai-compatible",
			model: "call-model",
		});

		Object.assign(config.call, original);
	});
});
