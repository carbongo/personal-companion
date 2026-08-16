/**
 * Incremental clause splitting for live voice calls. `takeParagraphs` (see
 * paragraphs.ts) is the right granularity for a voice note or the web chat,
 * where a whole paragraph can wait for its blank line — but a call has to get
 * audio back in well under a second of the model finishing a thought, so we
 * need to hand text to TTS well before a paragraph (or even a whole sentence)
 * is always available. `takeClauses` is the clause-level sibling: same
 * take-from-the-front-of-a-buffer shape, but it also cuts on sentence ends
 * and on strong internal boundaries (semicolons, colons, a comma before a
 * conjunction) once the accumulated text is long enough to be worth a TTS
 * request on its own.
 *
 * A naive split on /[.!?]/ shreds abbreviations ("Dr. Chen"), decimals
 * ("3.14", "v1.2.3"), ellipses ("well..."), and anything inside quotes or
 * parens. Getting those right is the entire point of this module — see the
 * test file for the exact cases this handles. Pure and stateless, like
 * paragraphs.ts: the caller owns the rolling buffer.
 */

/** Below this many non-whitespace characters, a clause isn't worth a TTS request on its own. */
const MIN_CLAUSE_CHARS = 20;

/** Titles and Latin abbreviations that end in a period but never end a sentence. */
const ABBREVIATIONS = [
	"dr.",
	"mr.",
	"mrs.",
	"ms.",
	"st.",
	"vs.",
	"etc.",
	"e.g.",
	"i.e.",
	"jr.",
	"sr.",
	"prof.",
	"inc.",
	"ltd.",
	"co.",
	"gen.",
	"rev.",
	"capt.",
	"approx.",
	"dept.",
	"est.",
	"fig.",
	"no.",
];

/** Coordinating conjunctions that turn a comma into a clause boundary ("..., but ..."). */
const CONJUNCTIONS = new Set(["and", "but", "or", "so", "yet", "nor", "for"]);

/**
 * Is the period at `dotIndex` the end of a known abbreviation rather than a
 * sentence? Matched by exact suffix against the lowercased buffer, guarded so
 * we don't false-positive on a longer word that merely ends the same way
 * (e.g. "cost." must not be read as the abbreviation "st.").
 */
function isAbbreviationAt(buffer: string, dotIndex: number): boolean {
	const lower = buffer.toLowerCase();
	for (const abbr of ABBREVIATIONS) {
		const start = dotIndex + 1 - abbr.length;
		if (start < 0) continue;
		if (lower.slice(start, dotIndex + 1) !== abbr) continue;
		const before = buffer[start - 1];
		if (before === undefined || !/[A-Za-z]/.test(before)) return true;
	}
	return false;
}

/**
 * If `buffer[commaIndex]` is a comma directly followed by whitespace and then
 * a coordinating conjunction, returns the boundary end index (right after the
 * comma, so the conjunction starts the next clause). Returns null otherwise,
 * including when the buffer simply hasn't produced the next word yet.
 */
function conjunctionBoundaryEnd(
	buffer: string,
	commaIndex: number,
): number | null {
	let k = commaIndex + 1;
	while (k < buffer.length && /\s/.test(buffer[k] as string)) k++;
	const wordStart = k;
	while (k < buffer.length && /[A-Za-z]/.test(buffer[k] as string)) k++;
	if (k === wordStart) return null;
	const word = buffer.slice(wordStart, k).toLowerCase();
	if (!CONJUNCTIONS.has(word)) return null;
	const after = buffer[k];
	if (after !== undefined && /[A-Za-z]/.test(after)) return null;
	return commaIndex + 1;
}

/**
 * Scan `buffer` for every clause-boundary end index, honouring quote/paren
 * nesting and the abbreviation/decimal/URL guards. A boundary at the very
 * end of the buffer is still reported here — `takeClauses` decides whether
 * it's safe to commit (it isn't, unless flushing: more text could still
 * arrive and change the reading, e.g. "3." becoming "3.14").
 */
function findBoundaries(buffer: string): number[] {
	const boundaries: number[] = [];
	let insideQuote = false;
	let parenDepth = 0;
	let i = 0;
	while (i < buffer.length) {
		const ch = buffer[i];
		if (ch === '"') {
			insideQuote = !insideQuote;
			i++;
			continue;
		}
		if (ch === "(") {
			parenDepth++;
			i++;
			continue;
		}
		if (ch === ")") {
			if (parenDepth > 0) parenDepth--;
			i++;
			continue;
		}
		if (insideQuote || parenDepth > 0) {
			i++;
			continue;
		}

		if (ch === "." || ch === "!" || ch === "?") {
			if (ch === "." && isAbbreviationAt(buffer, i)) {
				i++;
				continue;
			}
			// Consume a whole run so "...", "?!", "!!!" collapse to ONE boundary.
			let j = i;
			while (
				j < buffer.length &&
				(buffer[j] === "." || buffer[j] === "!" || buffer[j] === "?")
			)
				j++;
			const next = buffer[j];
			// Fused to the next character with no space — a decimal, a version
			// number, a URL ("example.com/path") — never a sentence end.
			if (next === undefined || /\s/.test(next)) boundaries.push(j);
			i = j;
			continue;
		}

		if (ch === ";" || ch === ":") {
			const end = i + 1;
			const next = buffer[end];
			// Same fused-to-next-char guard, so "3:30" and "http://" survive.
			if (next === undefined || /\s/.test(next)) boundaries.push(end);
			i++;
			continue;
		}

		if (ch === ",") {
			const end = conjunctionBoundaryEnd(buffer, i);
			if (end !== null) boundaries.push(end);
			i++;
			continue;
		}

		i++;
	}
	return boundaries;
}

/**
 * Pull every clause out of `buffer` that's both complete and long enough to
 * be worth its own TTS request, returning them and whatever tail remains.
 * Short fragments ("Yes." "No.") accumulate across boundaries until they
 * clear `MIN_CLAUSE_CHARS`, so a call doesn't fire off a TTS request per
 * word. Pass `{ flush: true }` once the stream has ended to emit whatever is
 * left regardless of length or boundary — nothing more is coming to
 * disambiguate it.
 *
 * Invariant: for any buffer, `clauses.join("") + rest === buffer` — no
 * character is ever dropped or duplicated.
 */
export function takeClauses(
	buffer: string,
	opts?: { flush?: boolean },
): { clauses: string[]; rest: string } {
	const flush = opts?.flush ?? false;
	const boundaries = findBoundaries(buffer);
	const clauses: string[] = [];
	let pendingStart = 0;
	for (const end of boundaries) {
		// A boundary that lands exactly at the end of what we've received so
		// far can't be trusted yet: more text might still turn "St." into part
		// of a longer word, or "well..." into a continued sentence.
		if (!flush && end === buffer.length) break;
		const text = buffer.slice(pendingStart, end);
		if (text.trim().length >= MIN_CLAUSE_CHARS) {
			clauses.push(text);
			pendingStart = end;
		}
	}
	let rest = buffer.slice(pendingStart);
	if (flush && rest.length > 0) {
		clauses.push(rest);
		rest = "";
	}
	return { clauses, rest };
}
