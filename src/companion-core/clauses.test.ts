import { describe, expect, it } from "bun:test";
import { takeClauses } from "#/companion-core/clauses.ts";

/** Streams `text` one character at a time through takeClauses, collecting every
 * emitted clause plus whatever remains after a final flush. Mirrors how the
 * call path will actually consume this: append a token, ask for ready clauses,
 * repeat, then flush at end of stream. */
function streamAll(text: string, chunkSize = 1): string[] {
	let buffer = "";
	const clauses: string[] = [];
	for (let i = 0; i < text.length; i += chunkSize) {
		buffer += text.slice(i, i + chunkSize);
		const { clauses: ready, rest } = takeClauses(buffer);
		clauses.push(...ready);
		buffer = rest;
	}
	const { clauses: finalReady, rest } = takeClauses(buffer, { flush: true });
	clauses.push(...finalReady);
	expect(rest).toBe("");
	return clauses;
}

describe("takeClauses", () => {
	it("does not split on titles and Latin abbreviations", () => {
		const text =
			"Dr. Chen reviewed the results, e.g. the blood panel, i.e. everything, etc. and vs. Mr. St. Claire's numbers, and found no issues at all.";
		const { clauses, rest } = takeClauses(text);
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		for (const c of clauses) {
			expect(c).not.toMatch(/^\s*Chen/);
			expect(c).not.toMatch(/^\s*Claire/);
		}
	});

	it("does not split on decimals, versions, and currency", () => {
		const text =
			"The release is v1.2.3 and costs $4.50, computed from a base rate of 3.14 per unit which is a fairly precise number to use.";
		const { clauses, rest } = takeClauses(text, { flush: false });
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		expect(clauses.join("")).not.toMatch(/v1$/);
		expect(clauses.join("")).not.toMatch(/\$4$/);
		expect(clauses.join("")).not.toMatch(/^\s*3$/);
	});

	it("treats an ellipsis as one boundary, not three", () => {
		const text =
			"Well, that is quite something... Let me think about how to respond to this properly.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		// The ellipsis is a single boundary right after "something...", and the
		// clause up to it is already long enough to be emitted on its own —
		// proving the three dots collapsed into one boundary, not three.
		expect(clauses[0]).toBe("Well, that is quite something...");
	});

	it("holds a trailing ellipsis mid-stream instead of finishing the clause early", () => {
		const { clauses, rest } = takeClauses(
			"I was thinking maybe we should go there but I keep hesitating...",
		);
		expect(clauses).toEqual([]);
		expect(rest).toBe(
			"I was thinking maybe we should go there but I keep hesitating...",
		);
	});

	it("flushes a trailing ellipsis when the stream ends", () => {
		const text =
			"I was thinking maybe we should go there but I keep hesitating...";
		const { clauses, rest } = takeClauses(text, { flush: true });
		expect(rest).toBe("");
		expect(clauses.join("")).toBe(text);
	});

	it("keeps the closing quote or paren attached to its clause", () => {
		const text =
			'"Stop!" she said, and then she turned around and walked away without saying another word.';
		const { clauses, rest } = takeClauses(text, { flush: true });
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		// The "!" is inside the quotes, so it must not have split there.
		expect(
			clauses.some(
				(c) => c.includes('"Stop!"') && c.trim().startsWith('"Stop!"'),
			),
		).toBe(true);
		for (const c of clauses) {
			expect(c).not.toBe('"Stop!"');
		}
	});

	it("does not split inside parenthetical asides", () => {
		const text =
			"The finding was surprising (though not entirely unexpected. Given prior work.) and it changed our plans for the following week.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		expect(
			clauses.some((c) => c.includes("though not entirely unexpected.")),
		).toBe(true);
	});

	it("does not split URLs", () => {
		const text =
			"You can find it at https://example.com/path/to/page.html which has all the details you need to get started.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		const whole = clauses.join("") + rest;
		expect(whole).toBe(text);
		expect(clauses.join("")).toContain("https://example.com/path/to/page.html");
	});

	it("accumulates short fragments instead of emitting each on its own", () => {
		const { clauses, rest } = takeClauses("Yes. No. Maybe.", { flush: false });
		// None of these alone clears MIN_CLAUSE_CHARS, so nothing is ready yet.
		expect(clauses).toEqual([]);
		expect(rest).toBe("Yes. No. Maybe.");
	});

	it("emits accumulated short fragments once flushed", () => {
		const { clauses, rest } = takeClauses("Yes. No. Maybe.", { flush: true });
		expect(rest).toBe("");
		expect(clauses.join("")).toBe("Yes. No. Maybe.");
	});

	it("emits once accumulated fragments clear the minimum length", () => {
		const text =
			"Yes. No. That's a much longer clause that clearly clears the minimum length threshold on its own, so it should split.";
		const { clauses, rest } = takeClauses(text, { flush: false });
		expect(clauses.length).toBeGreaterThan(0);
		expect(clauses.join("") + rest).toBe(text);
		// The short "Yes." / "No." fragments must have been folded into the first emitted clause.
		expect(clauses[0]).toContain("Yes.");
		expect(clauses[0]).toContain("No.");
	});

	it("splits on a strong internal boundary once the clause is long enough", () => {
		const text =
			"The weather turned unexpectedly cold overnight; we had to bring the plants inside before the frost.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		expect(clauses.join("") + rest).toBe(text);
		expect(clauses.some((c) => c.trim().endsWith(";"))).toBe(true);
	});

	it("splits on a comma before a conjunction once the clause is long enough", () => {
		const text =
			"We looked everywhere for the missing keys, but eventually gave up and just called a locksmith instead.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		expect(clauses.join("") + rest).toBe(text);
		expect(clauses.some((c) => c.trim().endsWith(","))).toBe(true);
	});

	it("does not split a comma unless it precedes a conjunction", () => {
		const text =
			"We bought apples, oranges, and pears, along with a few other things for the picnic tomorrow afternoon.";
		const { clauses, rest } = takeClauses(text, { flush: true });
		expect(clauses.join("") + rest).toBe(text);
		// "apples," and "oranges," are not before a conjunction, so no split there.
		expect(
			clauses.some((c) => c.trim() === "apples," || c.trim() === "oranges,"),
		).toBe(false);
	});

	it("holds an in-progress clause and never emits it early", () => {
		const { clauses, rest } = takeClauses(
			"This sentence is definitely long enough but has not ended yet",
		);
		expect(clauses).toEqual([]);
		expect(rest).toBe(
			"This sentence is definitely long enough but has not ended yet",
		);
	});

	it("emits an in-progress clause once flushed", () => {
		const text =
			"This sentence is definitely long enough but has not ended yet";
		const { clauses, rest } = takeClauses(text, { flush: true });
		expect(rest).toBe("");
		expect(clauses.join("")).toBe(text);
	});

	it("never loses or duplicates a character across a spread of inputs, streamed one char at a time", () => {
		const samples = [
			"",
			".",
			"...",
			"Dr. Chen said hello.",
			'"Stop!" she said. Then she left immediately without another word.',
			"The price is $4.50 for v1.2.3, which is a fair deal given the circumstances.",
			"Yes. No. Maybe. Who knows. This one is definitely long enough to be its own clause though.",
			"well... I suppose we could try that, but I'm not entirely sure it will work out.",
			"Visit https://example.com/a.b.c for more, or don't; it's up to you in the end.",
			"(Nested (parens) inside parens.) Still one clause? Let's find out together now.",
			"A very long sentence that just keeps going and going without any punctuation at all until finally it stops",
		];
		for (const sample of samples) {
			const clauses = streamAll(sample, 1);
			expect(clauses.join("")).toBe(sample);
		}
	});

	it("never loses or duplicates a character when streamed in larger chunks", () => {
		const text =
			'Dr. Chen reviewed v1.2.3 of the report, e.g. "Stop!" she said, but then continued reading anyway, and found nothing alarming in it at all.';
		for (const chunkSize of [3, 7, 16, 40]) {
			const clauses = streamAll(text, chunkSize);
			expect(clauses.join("")).toBe(text);
		}
	});

	it("is a pure function of its input — same buffer in, same result out", () => {
		const text =
			"This is a stable sentence. It should split the same way every single time it is called.";
		const first = takeClauses(text);
		const second = takeClauses(text);
		expect(first).toEqual(second);
	});
});
