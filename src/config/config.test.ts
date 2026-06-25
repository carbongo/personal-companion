import { describe, expect, it } from "bun:test";

import { loadConfig } from "./index.ts";

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
