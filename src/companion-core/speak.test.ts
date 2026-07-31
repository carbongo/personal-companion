import { describe, expect, it } from "bun:test";

import {
	shouldSpeak,
	speakState,
	stripSpeakTags,
	wantsSpeak,
} from "./speak.ts";

const modes = {
	speakMirror: false,
	speakOnRequest: false,
	speakSometimes: false,
};
const ctx = {
	turnWasVoice: false,
	requestedVoice: false,
	modelWantsSpeak: false,
};

describe("speak tags", () => {
	it("keeps the spoken words and drops only the markers", () => {
		expect(stripSpeakTags("<speak>hey there</speak>")).toBe("hey there");
	});

	it("leaves an untagged reply untouched", () => {
		expect(stripSpeakTags("hey there")).toBe("hey there");
		expect(wantsSpeak("hey there")).toBe(false);
	});

	it("notices a reply that asked to be spoken", () => {
		expect(wantsSpeak("sure —\n\n<speak>on my way</speak>")).toBe(true);
	});

	it("drops a half tag, which is all a streamed paragraph carries", () => {
		expect(stripSpeakTags("<speak>first half")).toBe("first half");
		expect(stripSpeakTags("second half</speak>")).toBe("second half");
	});
});

describe("speakState across streamed paragraphs", () => {
	it("carries an open passage into later paragraphs", () => {
		const a = speakState("<speak>one", false);
		expect(a).toEqual({ speak: true, open: true });

		const b = speakState("two", a.open); // no marker of its own
		expect(b).toEqual({ speak: true, open: true });

		const c = speakState("three</speak>", b.open);
		expect(c).toEqual({ speak: true, open: false });

		expect(speakState("an afterthought", c.open).speak).toBe(false);
	});
});

describe("shouldSpeak", () => {
	it("says nothing when every trigger is off", () => {
		expect(
			shouldSpeak(modes, {
				turnWasVoice: true,
				requestedVoice: true,
				modelWantsSpeak: true,
			}),
		).toBe(false);
	});

	it("mirrors a voice turn, and only a voice turn", () => {
		const m = { ...modes, speakMirror: true };
		expect(shouldSpeak(m, { ...ctx, turnWasVoice: true })).toBe(true);
		expect(shouldSpeak(m, ctx)).toBe(false);
	});

	it("speaks when the turn asked for it", () => {
		const m = { ...modes, speakOnRequest: true };
		expect(shouldSpeak(m, { ...ctx, requestedVoice: true })).toBe(true);
		expect(shouldSpeak(m, { ...ctx, modelWantsSpeak: true })).toBe(false);
	});

	it("honors the companion's own <speak> only when that mode is on", () => {
		expect(shouldSpeak(modes, { ...ctx, modelWantsSpeak: true })).toBe(false);
		expect(
			shouldSpeak(
				{ ...modes, speakSometimes: true },
				{ ...ctx, modelWantsSpeak: true },
			),
		).toBe(true);
	});
});
