// Whisper (and other STT models trained on subtitled video) hallucinate text from silence
// or near-silence — famously emitting subtitle boilerplate like "thanks for watching" when
// fed a room-tone clip. A live call has far more dead air than a chat voice note, so this
// gate runs on every transcript before it reaches the endpointer/LLM and rejects the
// well-known failure shapes: a high no-speech probability, a duration too short to have
// plausibly produced that much text, or a match against known artefact strings.

/** Known Whisper silence/artefact outputs, worth rejecting outright regardless of duration. */
export const HALLUCINATION_BLOCKLIST: readonly string[] = [
	"thanks for watching",
	"thank you for watching",
	"subscribe",
	"like and subscribe",
	".",
	"[blank_audio]",
	"[music]",
	"[applause]",
	"you",
];

const DEFAULT_NO_SPEECH_THRESHOLD = 0.6;
const DEFAULT_MIN_DURATION_MS = 200;

// A generous ceiling on human speech rate, used only to catch the physically implausible
// case (many words from a clip too short to have contained them). Deliberately loose —
// this isn't meant to flag fast talkers, only STT invention.
const MAX_PLAUSIBLE_WORDS_PER_SECOND = 5;

function normalize(text: string): string {
	return text.trim().toLowerCase();
}

function isBracketedSoundTag(text: string): boolean {
	// e.g. "[wind blowing]", "(laughs)", "(inaudible)" — a single tag spanning the whole
	// utterance, not incidental brackets inside real speech.
	return /^[[(][^\])]*[\])]$/.test(text.trim());
}

function hasLongRepeatedTokenRun(text: string, minRun = 4): boolean {
	const tokens = normalize(text)
		.replace(/[.,!?;:]+/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 0);
	let run = 1;
	for (let i = 1; i < tokens.length; i++) {
		if (tokens[i] === tokens[i - 1]) {
			run++;
			if (run >= minRun) return true;
		} else {
			run = 1;
		}
	}
	return false;
}

export function isLikelyHallucination(input: {
	text: string;
	noSpeechProb?: number;
	speechDurationMs: number;
	opts?: { noSpeechThreshold?: number; minDurationMs?: number };
}): boolean {
	const noSpeechThreshold =
		input.opts?.noSpeechThreshold ?? DEFAULT_NO_SPEECH_THRESHOLD;
	const minDurationMs = input.opts?.minDurationMs ?? DEFAULT_MIN_DURATION_MS;

	if (
		input.noSpeechProb !== undefined &&
		input.noSpeechProb > noSpeechThreshold
	) {
		return true;
	}

	const normalized = normalize(input.text);
	if (normalized === "") return true;

	if (HALLUCINATION_BLOCKLIST.includes(normalized)) return true;
	if (isBracketedSoundTag(normalized)) return true;
	if (hasLongRepeatedTokenRun(normalized)) return true;

	// Too short a clip to plausibly have produced this many words — a classic Whisper
	// silence-fill case (e.g. a 200ms blip transcribed as a full sentence).
	if (input.speechDurationMs < minDurationMs) return true;

	const wordCount = normalized.split(/\s+/).filter((t) => t.length > 0).length;
	const durationSeconds = input.speechDurationMs / 1000;
	const maxPlausibleWords = Math.max(
		1,
		durationSeconds * MAX_PLAUSIBLE_WORDS_PER_SECOND,
	);
	if (wordCount > maxPlausibleWords) return true;

	return false;
}
