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

	it("commits fast on a terminal exclamation", () => {
		const ep = createHeuristicEndpointer({ basePatienceMs: 700 });
		const result = ep.decide({ transcript: "watch out!", silenceMs: 350 });
		expect(result.commit).toBe(true);
		expect(result.reason).toBe("strong-terminator");
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
