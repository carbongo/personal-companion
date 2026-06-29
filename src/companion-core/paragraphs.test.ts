import { describe, expect, it } from "bun:test";

import { takeParagraphs } from "./paragraphs.ts";

describe("takeParagraphs", () => {
	it("emits complete paragraphs and keeps the in-progress tail", () => {
		const r = takeParagraphs("one\n\ntwo\n\nthr");
		expect(r.paragraphs).toEqual(["one", "two"]);
		expect(r.rest).toBe("thr");
	});

	it("holds a single paragraph until a blank line follows it", () => {
		const r = takeParagraphs("still writing this");
		expect(r.paragraphs).toEqual([]);
		expect(r.rest).toBe("still writing this");
	});

	it("treats a whitespace-only line as a separator", () => {
		const r = takeParagraphs("a\n \nb\n\n");
		expect(r.paragraphs).toEqual(["a", "b"]);
		expect(r.rest).toBe("");
	});

	it("rebuilds a stream fed one chunk at a time", () => {
		const chunks = ["He", "llo th", "ere.\n", "\nHow are ", "you?\n\n"];
		let buf = "";
		const out: string[] = [];
		for (const c of chunks) {
			buf += c;
			const { paragraphs, rest } = takeParagraphs(buf);
			out.push(...paragraphs);
			buf = rest;
		}
		expect(out).toEqual(["Hello there.", "How are you?"]);
		expect(buf).toBe("");
	});
});
