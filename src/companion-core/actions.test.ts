import { describe, expect, it } from "bun:test";

import { parseActions } from "./actions.ts";

describe("parseActions", () => {
	it("extracts remember/core tags and strips them", () => {
		const raw = [
			"Sounds good.",
			"<remember>likes strong tea</remember>",
			"<core>the two of you are easy together</core>",
		].join("\n");
		const p = parseActions(raw);
		expect(p.remember).toEqual(["likes strong tea"]);
		expect(p.core).toEqual(["the two of you are easy together"]);
		expect(p.cleaned).toBe("Sounds good.");
	});

	it("extracts and strips forget tags", () => {
		const raw = "Done — dropped that.\n<forget>likes strong tea</forget>";
		const p = parseActions(raw);
		expect(p.forget).toEqual(["likes strong tea"]);
		expect(p.cleaned).toBe("Done — dropped that.");
	});

	it("leaves a plain reply untouched", () => {
		const p = parseActions("just a normal reply");
		expect(p.remember).toEqual([]);
		expect(p.core).toEqual([]);
		expect(p.forget).toEqual([]);
		expect(p.cleaned).toBe("just a normal reply");
	});

	it("ignores empty tags", () => {
		const p = parseActions("hi <remember>   </remember>");
		expect(p.remember).toEqual([]);
		expect(p.cleaned).toBe("hi");
	});
});
