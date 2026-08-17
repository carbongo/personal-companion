// The roadmap originally called for "a small end-of-utterance model" — a purpose-trained
// classifier that listens to prosody and decides when a speaker is actually done. We are
// deliberately not shipping a second ML model this phase: one heuristic function, reading
// only the transcript text and the silence duration, gets us a usable v1 without a new
// runtime dependency or a model download. It is intentionally simple, not a placeholder
// apologized for — the `Endpointer` interface is the seam. A later phase can add an ONNX
// turn-detection model behind `createHeuristicEndpointer`'s same shape (a `decide`/`reset`
// pair) and no caller needs to change.

export interface EndpointDecision {
	commit: boolean;
	waitMs: number;
	reason: string;
}

export interface Endpointer {
	/** Decide whether the owner has finished speaking. */
	decide(input: { transcript: string; silenceMs: number }): EndpointDecision;
	reset(): void;
}

export interface HeuristicEndpointerOptions {
	/** Default silence patience before committing an otherwise-ordinary utterance. */
	basePatienceMs?: number;
	/** Patience applied when the transcript trails off mid-thought. */
	extendedPatienceMs?: number;
	/** Hard ceiling — commit no matter what once silence exceeds this. */
	maxWaitMs?: number;
}

// The owner speaks English and Russian, and switches between them mid-call, so every
// list below is the union of both. They are grouped by language rather than merged and
// sorted: each group is picked for the words that genuinely leave a thought hanging in
// that language, not translated across from the other one.

// English fillers and conjunctions — a turn that ends on one is still mid-sentence.
const HESITATION_MARKERS_EN = [
	"um",
	"uh",
	"er",
	"hmm",
	"like",
	"so",
	"and",
	"but",
	"because",
	"well",
];

// Russian: the hesitation sounds ("э", "ну", "типа", "это"), the conjunctions that
// always take a second clause ("и", "а", "но", "или", "чтобы"), and the tails of the
// multi-word ones — only the last word is ever inspected, so "потому что" and "как бы"
// are caught by "что" and "бы".
const HESITATION_MARKERS_RU = [
	"э",
	"ээ",
	"эм",
	"мм",
	"ну",
	"типа",
	"это",
	"короче",
	"значит",
	"и",
	"а",
	"но",
	"или",
	"что",
	"чтобы",
	"потому",
	"бы",
];

const HESITATION_MARKERS = [...HESITATION_MARKERS_EN, ...HESITATION_MARKERS_RU];

// Russian has no articles, so this list stays English-only.
const ARTICLES = ["a", "an", "the"];

// Prepositions worth flagging as "more is coming" when they trail an utterance — not
// exhaustive, just the common ones that leave a clause visibly hanging.
const TRAILING_PREPOSITIONS_EN = [
	"to",
	"of",
	"in",
	"on",
	"at",
	"for",
	"with",
	"about",
	"from",
	"into",
	"over",
	"as",
];

// Russian prepositions are proclitic: a sentence simply cannot end on one, which makes
// them the most reliable "she is not done" signal in the language.
const TRAILING_PREPOSITIONS_RU = [
	"в",
	"во",
	"на",
	"с",
	"со",
	"к",
	"ко",
	"о",
	"об",
	"для",
	"про",
	"из",
	"у",
	"за",
	"по",
	"от",
	"до",
	"при",
	"без",
];

const TRAILING_PREPOSITIONS = [
	...TRAILING_PREPOSITIONS_EN,
	...TRAILING_PREPOSITIONS_RU,
];

// Whisper punctuates generously: it will end "I went to the store" with a full stop
// while the owner is only drawing breath, and does the same in Russian. So terminal
// punctuation says very little about whether the thought is finished — length says
// more. Below this many words a tidy-looking declarative is treated as a fragment and
// given the extended wait, which is exactly the mid-thought pause that used to be
// answered as if it were a whole turn.
const SHORT_UTTERANCE_WORDS = 8;

// Straight and curly double quotes only — a bare `'` is ambiguous with a contraction
// apostrophe ("that's", "don't") far more often than it opens a real quotation, so we
// don't track it here to avoid false "unclosed" reads on ordinary speech.
const OPEN_QUOTES: Record<string, string> = {
	'"': '"',
	"“": "”",
	"‘": "’",
};

const OPEN_BRACKETS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
};

function lastWord(transcript: string): string {
	const words = transcript.trim().split(/\s+/);
	return words[words.length - 1] ?? "";
}

function stripPunctuation(word: string): string {
	return word.replace(/[.,!?;:]+$/, "").toLowerCase();
}

function hasUnclosedQuoteOrBracket(transcript: string): boolean {
	for (const [open, close] of Object.entries(OPEN_QUOTES)) {
		const opens = transcript.split(open).length - 1;
		const closes = transcript.split(close).length - 1;
		// Straight quote marks reuse the same character for open and close, so an odd
		// count means one is left dangling.
		if (open === close) {
			if (opens % 2 === 1) return true;
		} else if (opens > closes) {
			return true;
		}
	}
	for (const [open, close] of Object.entries(OPEN_BRACKETS)) {
		const opens = transcript.split(open).length - 1;
		const closes = transcript.split(close).length - 1;
		if (opens > closes) return true;
	}
	return false;
}

function looksMidWordCut(transcript: string): boolean {
	// A cut-off word: ends with a hyphen, or the last "word" has no trailing punctuation
	// and no vowel at all (whisper/other STT engines usually emit a partial syllable like
	// "wha-" or "th" when audio is truncated mid-word). We only flag the hyphen case
	// reliably; the no-vowel heuristic is intentionally narrow to avoid false positives on
	// short real words ("my", "by").
	const trimmed = transcript.trimEnd();
	return /-$/.test(trimmed);
}

function endsWithDanglingComma(transcript: string): boolean {
	return /,\s*$/.test(transcript);
}

/** Ends on a sentence-final mark — a full stop, exclamation or question mark. */
function endsWithTerminator(transcript: string): boolean {
	return /[.!?]\s*$/.test(transcript.trimEnd());
}

/** Trailing "..." / "…": the one punctuation whisper uses to mean "trailed off". */
function endsWithEllipsis(transcript: string): boolean {
	return /(\.\.\.|…)\s*$/.test(transcript.trimEnd());
}

function wordCount(transcript: string): number {
	return transcript.trim().split(/\s+/).filter(Boolean).length;
}

function isShortCompleteQuestion(transcript: string): boolean {
	const trimmed = transcript.trim();
	if (!/\?\s*$/.test(trimmed)) return false;
	return wordCount(trimmed) <= 12;
}

export function createHeuristicEndpointer(
	opts: HeuristicEndpointerOptions = {},
): Endpointer {
	const basePatienceMs = opts.basePatienceMs ?? 700;
	const extendedPatienceMs = opts.extendedPatienceMs ?? 1600;
	const maxWaitMs = opts.maxWaitMs ?? 3000;

	return {
		decide({ transcript, silenceMs }) {
			// The backstop always wins: never hang the call waiting on a heuristic that
			// misread the transcript.
			if (silenceMs >= maxWaitMs) {
				return { commit: true, waitMs: maxWaitMs, reason: "max-wait-exceeded" };
			}

			const trimmed = transcript.trim();
			const last = stripPunctuation(lastWord(trimmed));

			// A question mark is the one punctuation that carries turn-taking meaning:
			// asking hands the floor over explicitly. Everything else — full stops,
			// exclamations — is decided further down, by length rather than by mark.
			if (isShortCompleteQuestion(trimmed)) {
				const fastMs = Math.min(basePatienceMs, basePatienceMs * 0.5);
				if (silenceMs >= fastMs) {
					return {
						commit: true,
						waitMs: fastMs,
						reason: "short-complete-question",
					};
				}
				return {
					commit: false,
					waitMs: fastMs,
					reason: "short-complete-question-pending",
				};
			}

			if (endsWithEllipsis(trimmed)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "trailing-ellipsis-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "trailing-ellipsis",
				};
			}

			if (HESITATION_MARKERS.includes(last)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "hesitation-marker-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "hesitation-marker",
				};
			}

			if (TRAILING_PREPOSITIONS.includes(last)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "trailing-preposition-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "trailing-preposition",
				};
			}

			if (ARTICLES.includes(last)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "dangling-article-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "dangling-article",
				};
			}

			if (endsWithDanglingComma(trimmed)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "dangling-comma-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "dangling-comma",
				};
			}

			if (hasUnclosedQuoteOrBracket(trimmed)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "unclosed-quote-or-bracket-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "unclosed-quote-or-bracket",
				};
			}

			if (looksMidWordCut(trimmed)) {
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "mid-word-cut-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "mid-word-cut",
				};
			}

			// Terminal punctuation, and nothing above it read as unfinished. A whole
			// thought commits fast; a short one waits, because the full stop after
			// "I went to the store" is whisper's habit, not the owner yielding the
			// floor. Waiting costs her nothing — barge-in lets her cut straight back
			// in — while answering half a sentence is the thing she complained about.
			if (endsWithTerminator(trimmed)) {
				if (wordCount(trimmed) >= SHORT_UTTERANCE_WORDS) {
					const fastMs = Math.min(basePatienceMs, basePatienceMs * 0.5);
					if (silenceMs >= fastMs) {
						return {
							commit: true,
							waitMs: fastMs,
							reason: "complete-utterance",
						};
					}
					return {
						commit: false,
						waitMs: fastMs,
						reason: "complete-utterance-pending",
					};
				}
				if (silenceMs >= extendedPatienceMs) {
					return {
						commit: true,
						waitMs: extendedPatienceMs,
						reason: "short-declarative-timeout",
					};
				}
				return {
					commit: false,
					waitMs: extendedPatienceMs,
					reason: "short-declarative",
				};
			}

			// No special signal either way — ordinary base patience applies.
			if (silenceMs >= basePatienceMs) {
				return {
					commit: true,
					waitMs: basePatienceMs,
					reason: "base-patience-elapsed",
				};
			}
			return {
				commit: false,
				waitMs: basePatienceMs,
				reason: "awaiting-base-patience",
			};
		},
		reset() {
			// The heuristic is stateless per call — nothing to clear yet. Kept as a no-op
			// so the interface already matches what a stateful ONNX model would need.
		},
	};
}
