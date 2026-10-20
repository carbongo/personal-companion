import { describe, expect, it } from "bun:test";

import {
	sanitizeForSpeech,
	shouldSpeak,
	speakState,
	stripSpeakTags,
	wantsSpeak,
} from "./speak.ts";

const modes = {
	speakMirror: false,
	speakOnRequest: false,
	speakSometimes: false,
	speakChance: 0,
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

	it("speaks by chance when the turn's roll lands under speakChance", () => {
		const m = { ...modes, speakChance: 0.2 };
		expect(shouldSpeak(m, { ...ctx, roll: 0.1 })).toBe(true);
		expect(shouldSpeak(m, { ...ctx, roll: 0.5 })).toBe(false);
		expect(shouldSpeak(modes, { ...ctx, roll: 0 })).toBe(false);
		expect(shouldSpeak(m, ctx)).toBe(false);
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

describe("sanitizeForSpeech", () => {
	it("drops bold markers but keeps the words", () => {
		expect(sanitizeForSpeech("this is **very** important")).toBe(
			"this is very important",
		);
		expect(sanitizeForSpeech("___bold italic___")).toBe("bold italic");
	});

	it("drops single-asterisk/underscore action beats whole, not just the markers", () => {
		expect(sanitizeForSpeech("*quiet a second*")).toBe("");
		expect(sanitizeForSpeech("sure. *sighs* let me check")).toBe(
			"sure. let me check",
		);
		expect(sanitizeForSpeech("a _thoughtful pause_ then yes")).toBe(
			"a then yes",
		);
	});

	it("leaves snake_case identifiers alone", () => {
		expect(sanitizeForSpeech("run my_variable_name now")).toBe(
			"run my_variable_name now",
		);
	});

	it("keeps link/image text and drops the target", () => {
		expect(sanitizeForSpeech("see [the docs](https://example.com)")).toBe(
			"see the docs",
		);
		expect(sanitizeForSpeech("![a cat](cat.png)")).toBe("a cat");
	});

	it("keeps code text and drops the fences", () => {
		expect(sanitizeForSpeech("run `bun test`")).toBe("run bun test");
		expect(sanitizeForSpeech("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
	});

	it("drops headers and bullet markers, keeping the text", () => {
		expect(sanitizeForSpeech("## Heading\n\n- one\n- two")).toBe(
			"Heading\n\none\ntwo",
		);
	});

	it("drops horizontal rules and table rules entirely", () => {
		expect(sanitizeForSpeech("above\n---\nbelow")).toBe("above\n\nbelow");
		expect(sanitizeForSpeech("a | b\n---|---\n1 | 2")).toBe("a , b\n\n1 , 2");
	});

	it("strips any stray formatting symbol left over", () => {
		expect(sanitizeForSpeech("weird ~~strike~~ # text")).toBe(
			"weird strike text",
		);
	});
});
