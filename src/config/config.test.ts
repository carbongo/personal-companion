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
		])
			delete process.env[k];

		const { telegram, stt } = loadConfig();
		expect(telegram.botToken).toBe("");
		expect(telegram.allowedUserIds).toEqual([]);
		expect(telegram.replySplit).toBe(true);
		expect(telegram.batchIdleMs).toBe(2500);
		expect(telegram.batchMaxMs).toBe(15000);
		expect(stt.provider).toBe("off");

		process.env = prev;
	});
});
