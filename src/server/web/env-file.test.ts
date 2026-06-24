import { describe, expect, test } from "bun:test";

import { serializeEnvUpdates } from "./env-file.ts";

describe("serializeEnvUpdates", () => {
	test("updates an existing key in place, preserving everything else", () => {
		const existing = "# my config\nCOMPANION_NAME=Old\nPORT=8080\n";
		const out = serializeEnvUpdates(existing, { COMPANION_NAME: "New" });
		expect(out).toBe("# my config\nCOMPANION_NAME=New\nPORT=8080\n");
	});

	test("appends a missing key after a blank line", () => {
		const out = serializeEnvUpdates("PORT=8080\n", { LLM_MODEL: "gemma4:12b" });
		expect(out).toBe("PORT=8080\n\nLLM_MODEL=gemma4:12b\n");
	});

	test("leaves undefined keys untouched", () => {
		const existing = "TELEGRAM_BOT_TOKEN=keep-me\n";
		const out = serializeEnvUpdates(existing, {
			TELEGRAM_BOT_TOKEN: undefined,
			COMPANION_OWNER: "friend",
		});
		expect(out).toContain("TELEGRAM_BOT_TOKEN=keep-me");
		expect(out).toContain("COMPANION_OWNER=friend");
	});

	test("quotes values that contain spaces or special characters", () => {
		const out = serializeEnvUpdates("", {
			COMPANION_OWNER: "Dr. Jane Doe",
			LLM_MODEL: "gemma4:12b",
		});
		expect(out).toContain('COMPANION_OWNER="Dr. Jane Doe"');
		// Bare-safe values (incl. ":") are written unquoted.
		expect(out).toContain("LLM_MODEL=gemma4:12b");
	});

	test("escapes embedded quotes and newlines", () => {
		const out = serializeEnvUpdates("", { K: 'a "b"\nc' });
		expect(out).toBe('K="a \\"b\\"\\nc"\n');
	});

	test("handles an empty starting file and always ends with a newline", () => {
		const out = serializeEnvUpdates("", { PORT: "8080" });
		expect(out).toBe("PORT=8080\n");
	});

	test("ignores comments and blank lines when matching keys", () => {
		const existing = "# COMPANION_NAME=commented\n\nCOMPANION_NAME=Real\n";
		const out = serializeEnvUpdates(existing, { COMPANION_NAME: "Updated" });
		expect(out).toBe("# COMPANION_NAME=commented\n\nCOMPANION_NAME=Updated\n");
	});

	test("matches keys written with an `export` prefix", () => {
		const out = serializeEnvUpdates("export PORT=8080\n", { PORT: "9000" });
		expect(out).toBe("PORT=9000\n");
	});
});
