import { describe, expect, it } from "bun:test";
import {
	HALLUCINATION_BLOCKLIST,
	isLikelyHallucination,
} from "#/companion-core/call/hallucination-gate.ts";

describe("isLikelyHallucination", () => {
	it("rejects when noSpeechProb exceeds the threshold", () => {
		const result = isLikelyHallucination({
			text: "I'll be right there",
			noSpeechProb: 0.9,
			speechDurationMs: 1200,
		});
		expect(result).toBe(true);
	});

	it("does not reject when noSpeechProb is under the threshold", () => {
		const result = isLikelyHallucination({
			text: "I'll be right there",
			noSpeechProb: 0.2,
			speechDurationMs: 1200,
		});
		expect(result).toBe(false);
	});

	it("respects a custom noSpeechThreshold", () => {
		const result = isLikelyHallucination({
			text: "I'll be right there",
			noSpeechProb: 0.5,
			speechDurationMs: 1200,
			opts: { noSpeechThreshold: 0.4 },
		});
		expect(result).toBe(true);
	});

	it("rejects a duration too short to have plausibly produced that much text", () => {
		// A twelve-word sentence out of a 200ms blip is physically implausible.
		const result = isLikelyHallucination({
			text: "thank you so much for listening to this whole episode today",
			speechDurationMs: 200,
		});
		expect(result).toBe(true);
	});

	it("does not reject ordinary short speech at a plausible duration", () => {
		for (const text of ["no", "stop", "hello"]) {
			expect(isLikelyHallucination({ text, speechDurationMs: 400 })).toBe(
				false,
			);
		}
	});

	// The blocklist is exported readonly, which `it.each` will not accept directly.
	it.each([
		...HALLUCINATION_BLOCKLIST,
	])("rejects known artefact string %s", (artefact) => {
		const result = isLikelyHallucination({
			text: artefact,
			speechDurationMs: 1500,
		});
		expect(result).toBe(true);
	});

	it("rejects blocklist matches regardless of casing/whitespace", () => {
		const result = isLikelyHallucination({
			text: "  Thanks For Watching  ",
			speechDurationMs: 1500,
		});
		expect(result).toBe(true);
	});

	it("rejects bracketed/parenthesised sound tags generally", () => {
		expect(
			isLikelyHallucination({ text: "[wind blowing]", speechDurationMs: 1500 }),
		).toBe(true);
		expect(
			isLikelyHallucination({ text: "(laughs)", speechDurationMs: 1500 }),
		).toBe(true);
		expect(
			isLikelyHallucination({ text: "(inaudible)", speechDurationMs: 1500 }),
		).toBe(true);
	});

	it("rejects long runs of a repeated identical token", () => {
		const result = isLikelyHallucination({
			text: "the the the the the",
			speechDurationMs: 1500,
		});
		expect(result).toBe(true);
	});

	it("does not reject a short natural repetition", () => {
		const result = isLikelyHallucination({
			text: "no no, I meant the other one",
			speechDurationMs: 1500,
		});
		expect(result).toBe(false);
	});

	it("rejects empty text", () => {
		const result = isLikelyHallucination({
			text: "   ",
			speechDurationMs: 1500,
		});
		expect(result).toBe(true);
	});

	it("allows a custom minDurationMs to relax the floor", () => {
		const result = isLikelyHallucination({
			text: "no",
			speechDurationMs: 100,
			opts: { minDurationMs: 50 },
		});
		expect(result).toBe(false);
	});

	it("does not reject ordinary conversational speech at normal length", () => {
		const result = isLikelyHallucination({
			text: "can you remind me what time the meeting is tomorrow",
			noSpeechProb: 0.1,
			speechDurationMs: 3500,
		});
		expect(result).toBe(false);
	});
});
