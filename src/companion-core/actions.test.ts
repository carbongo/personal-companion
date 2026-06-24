import { describe, expect, it } from "bun:test";

import { parseActions } from "./actions.ts";

describe("parseActions", () => {
	it("extracts remember/core/note tags and strips them", () => {
		const raw = [
			"Sounds good.",
			"<remember>likes strong tea</remember>",
			"<core>the two of you are easy together</core>",
			'<note title="Idea">build a small thing</note>',
		].join("\n");
		const p = parseActions(raw);
		expect(p.remember).toEqual(["likes strong tea"]);
		expect(p.core).toEqual(["the two of you are easy together"]);
		expect(p.notes).toEqual([{ title: "Idea", body: "build a small thing" }]);
		expect(p.cleaned).toBe("Sounds good.");
	});

	it("leaves a plain reply untouched", () => {
		const p = parseActions("just a normal reply");
		expect(p.remember).toEqual([]);
		expect(p.core).toEqual([]);
		expect(p.notes).toEqual([]);
		expect(p.cleaned).toBe("just a normal reply");
	});

	it("defaults the note title when none is given", () => {
		const p = parseActions("<note>untitled body</note>");
		expect(p.notes[0]?.title).toBe("Note");
		expect(p.notes[0]?.body).toBe("untitled body");
	});

	it("ignores empty tags", () => {
		const p = parseActions("hi <remember>   </remember>");
		expect(p.remember).toEqual([]);
		expect(p.cleaned).toBe("hi");
	});
});
