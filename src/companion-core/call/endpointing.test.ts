import { describe, expect, it } from "bun:test";
import { createHeuristicEndpointer } from "#/companion-core/call/endpointing.ts";

describe("createHeuristicEndpointer", () => {
	it("commits once silence exceeds base patience on ordinary text", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "I think that's everything",
			silenceMs: 700,
		});
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("base-patience-elapsed");
	});

	it("does not commit ordinary text before base patience elapses", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "I think that's everything",
			silenceMs: 300,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("awaiting-base-patience");
	});

	it("extends wait on a trailing hesitation marker instead of committing", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({
			transcript: "so I was thinking, um",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("hesitation-marker");
		expect(result.waitMs).toBeGreaterThan(700);
	});

	it("commits after the extended patience elapses on a hesitation marker", () => {
		const ep = createHeuristicEndpointer({ extendedPatienceMs: 1600 });
		const result = ep.decide({ transcript: "well, um", silenceMs: 1600 });
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("hesitation-marker-timeout");
	});

	it("extends wait on a trailing conjunction (hesitation marker)", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "I wanted to go but",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("hesitation-marker");
	});

	it("extends wait on a trailing preposition", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "put it on top of",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("trailing-preposition");
	});

	it("extends wait on a dangling comma", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "first we go to the store,",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("dangling-comma");
	});

	it("extends wait on a mid-word cut", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "I was going to the sta-",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("mid-word-cut");
	});

	it("extends wait on a dangling article", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "can you hand me the",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("dangling-article");
	});

	it("extends wait on an unclosed quote", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: 'she said "wait for me',
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("unclosed-quote-or-bracket");
	});

	it("extends wait on an unclosed bracket", () => {
		const ep = createHeuristicEndpointer({});
		const result = ep.decide({
			transcript: "check the file (in the folder",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("unclosed-quote-or-bracket");
	});

	it("commits fast on a substantial sentence with a terminal mark", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({
			transcript: "I finished the report and sent it already.",
			silenceMs: 350,
		});
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("complete-utterance");
		expect(result.waitMs).toBeLessThan(700);
	});

	it("commits fast on a short complete question", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({
			transcript: "what time is it?",
			silenceMs: 350,
		});
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("short-complete-question");
		expect(result.waitMs).toBeLessThan(700);
	});

	it("holds a short declarative however tidily whisper punctuated it", () => {
		// The bug the owner hit: half a thought, ended with a full stop by a
		// decoder that punctuates on breath, answered as if it were a whole turn.
		const ep = createHeuristicEndpointer({
			basePatienceMs: 700,
			extendedPatienceMs: 1600,
		});
		const result = ep.decide({
			transcript: "I went to the store.",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("short-declarative");
		expect(result.waitMs).toBe(1600);
	});

	it("a short exclamation is held too — the mark is emphasis, not a handover", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({ transcript: "watch out!", silenceMs: 700 });
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("short-declarative");
	});

	it("commits a held short declarative once the extended patience runs out", () => {
		const ep = createHeuristicEndpointer({ extendedPatienceMs: 1600 });
		const result = ep.decide({
			transcript: "I went to the store.",
			silenceMs: 1600,
		});
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("short-declarative-timeout");
	});

	it("a short question still commits fast — asking hands the floor over", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({ transcript: "did you eat?", silenceMs: 350 });
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("short-complete-question");
	});

	it("extends wait on a trailing ellipsis", () => {
		const ep = createHeuristicEndpointer({ extendedPatienceMs: 1600 });
		const result = ep.decide({
			transcript: "I was thinking we could maybe just...",
			silenceMs: 700,
		});
		expect(result.commit).toBe(false);
		expect(result.reason).toBe("trailing-ellipsis");
		expect(result.waitMs).toBe(1600);
	});

	describe("Russian", () => {
		it("extends wait on a trailing conjunction", () => {
			const ep = createHeuristicEndpointer({
				basePatienceMs: 700,
				extendedPatienceMs: 1600,
			});
			for (const transcript of [
				"я пошла в магазин и",
				"хотела позвонить но",
				"мы можем сегодня или",
				"я думаю что",
				"я осталась дома потому что",
			]) {
				const result = ep.decide({ transcript, silenceMs: 700 });
				expect(result.commit).toBe(false);
				expect(result.reason).toBe("hesitation-marker");
				expect(result.waitMs).toBe(1600);
			}
		});

		it("extends wait on a trailing preposition", () => {
			const ep = createHeuristicEndpointer({ extendedPatienceMs: 1600 });
			for (const transcript of [
				"положи это на",
				"я поеду в",
				"поговорим об",
				"это для",
			]) {
				const result = ep.decide({ transcript, silenceMs: 700 });
				expect(result.commit).toBe(false);
				expect(result.reason).toBe("trailing-preposition");
			}
		});

		it("extends wait on a hesitation sound", () => {
			const ep = createHeuristicEndpointer({ extendedPatienceMs: 1600 });
			for (const transcript of ["ну", "это как бы", "я не знаю типа"]) {
				const result = ep.decide({ transcript, silenceMs: 700 });
				expect(result.commit).toBe(false);
				expect(result.reason).toBe("hesitation-marker");
			}
		});

		it("still commits a finished Russian sentence", () => {
			const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
			const result = ep.decide({
				transcript: "я вернулась домой и легла спать",
				silenceMs: 700,
			});
			expect(result.commit).toBe(true);
			expect(result.reason).toBe("base-patience-elapsed");
		});

		it("commits a Russian question fast", () => {
			const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
			const result = ep.decide({ transcript: "ты уже поел?", silenceMs: 350 });
			expect(result.commit).toBe(true);
			expect(result.reason).toBe("short-complete-question");
		});
	});

	it("always commits once maxWaitMs is exceeded, whatever the text looks like", () => {
		const ep = createHeuristicEndpointer({ maxWaitMs: 3000 });
		const result = ep.decide({ transcript: "and um the", silenceMs: 3000 });
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("max-wait-exceeded");
	});

	it("maxWaitMs backstop wins even over a mid-hesitation transcript beyond the limit", () => {
		const ep = createHeuristicEndpointer({
			maxWaitMs: 3000,
			extendedPatienceMs: 1600,
		});
		const result = ep.decide({ transcript: "um, because", silenceMs: 5000 });
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("max-wait-exceeded");
	});

	it("reset is a no-op that does not throw", () => {
		const ep = createHeuristicEndpointer({});
		expect(() => ep.reset()).not.toThrow();
	});
});
