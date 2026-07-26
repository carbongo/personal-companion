import { describe, expect, it } from "bun:test";

import { companionPreset, DEFAULT_PRESET, PRESETS } from "./presets.ts";

const vars = { name: "Companion", owner: "friend" };

describe("PRESETS", () => {
	it("gives every archetype both an identity and its own interests", () => {
		for (const [id, preset] of Object.entries(PRESETS)) {
			expect(preset.identity(vars).trim(), id).not.toBe("");
			// Interests are what the companion steers toward when a thread runs out;
			// an archetype without them has nothing to move to but the owner's words.
			expect(preset.interests(vars).trim().length, id).toBeGreaterThan(40);
		}
	});

	it("names the companion and the owner rather than hardcoding a character", () => {
		for (const [id, preset] of Object.entries(PRESETS)) {
			const text = preset.identity({ name: "Atlas", owner: "Sam" });
			expect(text, id).toContain("Atlas");
			expect(text, id).toContain("Sam");
		}
	});

	it("has a default that exists and a defined fallback", () => {
		expect(PRESETS[DEFAULT_PRESET]).toBeDefined();
		expect(companionPreset).toBe(PRESETS.companion as typeof companionPreset);
	});
});
