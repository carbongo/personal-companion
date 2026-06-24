import { describe, expect, it } from "bun:test";

import { splitReply } from "./split.ts";

describe("splitReply", () => {
	it("returns nothing for empty or whitespace input", () => {
		expect(splitReply("", { paragraphs: true })).toEqual([]);
		expect(splitReply("   \n\n ", { paragraphs: true })).toEqual([]);
	});

	it("keeps a short reply as a single message", () => {
		const parts = splitReply("hey, how's it going?", { paragraphs: true });
		expect(parts).toEqual(["hey, how's it going?"]);
	});

	it("splits paragraphs into separate messages", () => {
		const text = "First thought.\n\nSecond thought.\n\nThird.";
		expect(splitReply(text, { paragraphs: true })).toEqual([
			"First thought.",
			"Second thought.",
			"Third.",
		]);
	});

	it("preserves single newlines within a paragraph", () => {
		const text = "line one\nline two\n\nnext para";
		expect(splitReply(text, { paragraphs: true })).toEqual([
			"line one\nline two",
			"next para",
		]);
	});

	it("keeps everything in one message when paragraphs is off", () => {
		const text = "First.\n\nSecond.\n\nThird.";
		expect(splitReply(text, { paragraphs: false })).toEqual([text]);
	});

	it("hard-wraps a block longer than the limit", () => {
		const long = `${"a".repeat(50)} ${"b".repeat(50)} ${"c".repeat(50)}`;
		const parts = splitReply(long, { paragraphs: true, maxLen: 60 });
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) expect(p.length).toBeLessThanOrEqual(60);
		// No content lost (modulo the spaces we break on).
		expect(parts.join(" ").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
	});

	it("never emits a chunk over Telegram's hard limit even if asked", () => {
		const huge = "x".repeat(9000);
		const parts = splitReply(huge, { paragraphs: false, maxLen: 99999 });
		for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
	});
});
