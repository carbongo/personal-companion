// Live voice calls pick up listener noise the owner never meant as a turn: "mhm", "yeah",
// "ok" said while the companion is still talking. Sending that to the LLM either derails
// the reply or triggers an empty/confused response, so the call session filters it out
// before it reaches `engine.respond`. Erring toward false negatives (letting real content
// through as if it were a real turn) is fine — the companion just answers a short message.
// Erring toward false positives (dropping real content) means the companion ignores the
// owner, so every token in the utterance must be a known noise word for this to fire.

const BACKCHANNEL_WORDS = new Set([
	"mhm",
	"mmhm",
	"mm-hmm",
	"uh-huh",
	"uhhuh",
	"yeah",
	"yea",
	"yep",
	"yup",
	"ok",
	"okay",
	"right",
	"sure",
	"hmm",
	"hm",
	"oh",
	"wow",
]);

// Multi-word noise phrases, checked against the whole normalized utterance before falling
// back to per-token checking — "i see" and "got it" aren't noise word-by-word ("i", "see",
// "got", "it" all carry meaning individually) but are as fixed phrases.
const BACKCHANNEL_PHRASES = new Set(["i see", "got it"]);

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[.,!?;:]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function isBackchannelOnly(text: string): boolean {
	const normalized = normalize(text);
	if (normalized === "") return false;

	if (BACKCHANNEL_PHRASES.has(normalized)) return true;

	// Repetitions/combinations of phrases ("yeah yeah", "mhm ok") — strip each known phrase
	// occurrence out and see if anything besides noise words remains.
	let remainder = normalized;
	for (const phrase of BACKCHANNEL_PHRASES) {
		remainder = remainder.split(phrase).join(" ");
	}

	const tokens = remainder.split(/\s+/).filter((t) => t.length > 0);
	if (tokens.length === 0) return true;

	return tokens.every((token) => BACKCHANNEL_WORDS.has(token));
}
