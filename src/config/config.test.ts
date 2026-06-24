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
});
