import { describe, expect, test } from "bun:test";

import { sessionToken } from "./auth.ts";

describe("sessionToken", () => {
	test("is deterministic for a given password", () => {
		expect(sessionToken("hunter2")).toBe(sessionToken("hunter2"));
	});

	test("differs for different passwords", () => {
		expect(sessionToken("hunter2")).not.toBe(sessionToken("hunter3"));
	});

	test("is a 64-char hex digest (never the password itself)", () => {
		const token = sessionToken("a-secret-password");
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(token).not.toContain("a-secret-password");
	});
});
