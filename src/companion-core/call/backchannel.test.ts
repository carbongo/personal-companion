import { describe, expect, it } from "bun:test";
import { isBackchannelOnly } from "#/companion-core/call/backchannel.ts";

describe("isBackchannelOnly", () => {
	it.each([
		"mhm",
		"uh-huh",
		"yeah",
		"yep",
		"ok",
		"okay",
		"right",
		"sure",
		"hmm",
		"oh",
		"wow",
		"i see",
		"got it",
	])("treats %s as backchannel-only", (text) => {
		expect(isBackchannelOnly(text)).toBe(true);
	});

	it("handles punctuation and casing", () => {
		expect(isBackchannelOnly("Yeah!")).toBe(true);
		expect(isBackchannelOnly("OK.")).toBe(true);
		expect(isBackchannelOnly("  mhm  ")).toBe(true);
	});

	it("handles repeated/combined backchannel words", () => {
		expect(isBackchannelOnly("yeah yeah")).toBe(true);
		expect(isBackchannelOnly("mhm ok")).toBe(true);
		expect(isBackchannelOnly("right, right")).toBe(true);
	});

	it("returns true for whitespace-only input treated as empty noise", () => {
		// Empty input carries nothing to send to the LLM either, but it's not "noise" per
		// se — guard explicitly so callers relying on this for filtering don't misclassify.
		expect(isBackchannelOnly("")).toBe(false);
	});

	it.each([
		"yeah do it",
		"ok but why",
		"sure, tomorrow",
		"no",
		"stop",
		"yes please",
		"right, I'll call you back at five",
		"hmm interesting, tell me more",
	])("does not treat %s as backchannel-only", (text) => {
		expect(isBackchannelOnly(text)).toBe(false);
	});
});
