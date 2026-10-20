import { describe, expect, it } from "bun:test";

import { config } from "#/config/index.ts";
import { setSetting } from "./memory/store.ts";
import { buildIdentity, buildInterests, buildOperating } from "./persona.ts";

describe("buildIdentity", () => {
	it("falls back to a preset that names the companion", () => {
		const id = buildIdentity();
		expect(id).toContain(config.app.name);
	});

	it("honors a settings override with {{name}}/{{owner}} interpolation", () => {
		setSetting("persona", "I am {{name}}, here for {{owner}}.");
		expect(buildIdentity()).toBe(
			`I am ${config.app.name}, here for ${config.app.owner}.`,
		);
	});
});

describe("buildOperating", () => {
	it("never offers inline memory tags — memory is roll-up-managed now", () => {
		for (const autoMemory of [true, false]) {
			const op = buildOperating({ web: true, autoMemory });
			expect(op).not.toContain("<remember>");
			expect(op).not.toContain("<core>");
			expect(op).not.toContain("<forget>");
		}
	});

	it("describes memory that's curated overnight when auto-memory is on", () => {
		const op = buildOperating({ web: true, autoMemory: true });
		expect(op.toLowerCase()).toContain("overnight");
		// The model must not claim to save/forget on the spot.
		expect(op.toLowerCase()).toContain("never say you just saved");
	});

	it("describes read-only memory when auto-memory is off", () => {
		const op = buildOperating({ web: true, autoMemory: false });
		expect(op.toLowerCase()).toContain("managed for you");
	});

	it("includes web tags only when web access is on", () => {
		expect(buildOperating({ web: true, autoMemory: true })).toContain(
			"<search>",
		);
		expect(buildOperating({ web: false, autoMemory: true })).not.toContain(
			"<search>",
		);
	});

	it("tells the companion to drop what the owner didn't pick up", () => {
		const op = buildOperating({ web: false, autoMemory: true }).toLowerCase();
		expect(op).toContain("how the conversation moves");
		expect(op).toContain("that is the answer");
		expect(op).toContain("allowed to change the subject");
	});
});

describe("buildInterests", () => {
	// The preset fallback isn't asserted here: it only applies when no persona
	// override and no persona/persona.md exist, and the file is the owner's — a
	// dev box that has one would flip the result. PRESETS is covered directly in
	// presets.test.ts instead.

	it("honors an override with {{owner}} interpolation", () => {
		setSetting("persona", "");
		setSetting(
			"interests",
			"shipping forecasts and {{owner}}'s terrible taste",
		);
		expect(buildInterests()).toContain(
			`shipping forecasts and ${config.app.owner}'s terrible taste`,
		);
	});

	it("stays out of the way of a hand-written persona", () => {
		setSetting("interests", "");
		setSetting("persona", "I am {{name}}. That is all there is to say.");
		expect(buildInterests()).toBe("");
		setSetting("persona", "");
	});

	it("explains voice-on-ask only when it can be honored", () => {
		expect(
			buildOperating({ web: false, autoMemory: true, speakOnAsk: true }),
		).toContain("<speak>");
		expect(buildOperating({ web: false, autoMemory: true })).not.toContain(
			"<speak>",
		);
	});
});
