/**
 * Spoken replies. The companion may wrap some or all of a reply in
 * `<speak>…</speak>` to ask for it to be said out loud. Unlike the web tags,
 * what sits inside is real reply text — so only the markers come off and the
 * words still reach the user as normal text; the tag is a hint, never hidden
 * markup.
 *
 * Whether audio is actually synthesized is a separate decision (`shouldSpeak`):
 * three independent triggers, each switchable, so the tag alone can never
 * produce unsolicited audio. See docs/configuration.md.
 */

/** Both markers, in any casing — content is kept, only the tags come off. */
const RE_SPEAK_MARKER = /<\/?speak>/gi;
const RE_SPEAK_OPEN = /^<speak>$/i;

/** Remove the speak markers, leaving the spoken words as ordinary reply text. */
export function stripSpeakTags(raw: string): string {
	return raw
		.replace(RE_SPEAK_MARKER, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Whether a chunk of reply belongs to a `<speak>` passage, and whether that
 * passage is still open afterwards. A streamed reply arrives paragraph by
 * paragraph, so a passage opened in an earlier paragraph carries no marker of
 * its own — the caller threads `open` through the chunks to keep the thread.
 */
export function speakState(
	raw: string,
	open = false,
): { speak: boolean; open: boolean } {
	let cur = open;
	let speak = open;
	for (const m of raw.matchAll(RE_SPEAK_MARKER)) {
		if (RE_SPEAK_OPEN.test(m[0])) {
			cur = true;
			speak = true;
		} else {
			cur = false;
		}
	}
	return { speak, open: cur };
}

/** Whether a whole (non-streamed) reply asked to be spoken. */
export function wantsSpeak(raw: string): boolean {
	return speakState(raw).speak;
}

/**
 * Reduce reply text to what should actually be read aloud. The reply text
 * shown on screen keeps its markdown — the web and Telegram clients render
 * it — but a TTS voice has no renderer, so a literal `**word**` comes out as
 * "asterisk asterisk word asterisk asterisk". This strips markdown
 * formatting (keeping the words inside bold/code/links) and drops the
 * punctuation-only artifacts (headers, bullets, table rules, stray
 * fence/format characters) that a voice model would otherwise pronounce as
 * symbol names. Single-asterisk/underscore spans (`*sighs*`, `*goes quiet
 * for a second*`) are dropped whole rather than unwrapped — that's how chat
 * models write non-verbal action beats, never actual dialogue, so a voice
 * has nothing sensible to say for them. Only `synthesize()` callers use
 * this — the text sent for display is untouched.
 */
export function sanitizeForSpeech(text: string): string {
	let out = text;

	// Fenced code blocks: drop the fence + language tag, keep the body.
	out = out.replace(/```[^\n]*\n?/g, "").replace(/```/g, "");

	// Images and links: keep the visible label, drop the target.
	out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

	// Bold/bold-italic is real emphasis on real words — keep them, drop the
	// markers (longest run first).
	out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
	out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
	out = out.replace(/___([^_]+)___/g, "$1");
	out = out.replace(/__([^_]+)__/g, "$1");

	// Single-asterisk/underscore spans are how chat models write non-verbal
	// action beats (*sighs*, *goes quiet for a second*) — never dialogue, so
	// they're dropped whole rather than spoken as if they were words.
	out = out.replace(/\*([^*\n]+)\*/g, "");
	out = out.replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "");

	// Inline code and strikethrough: keep the words.
	out = out.replace(/`([^`]+)`/g, "$1");
	out = out.replace(/~~([^~]+)~~/g, "$1");

	// Headers: drop the leading #'s, keep the heading text. `[ \t]`, not `\s`
	// — `\s` matches `\n` too, which would reach into the next line.
	out = out.replace(/^#{1,6}[ \t]+/gm, "");

	// Horizontal rules and table separator rows: pure punctuation, drop the
	// line (but not the blank line it sat on — same `[ \t]` reasoning).
	out = out.replace(/^[ \t]*[-*_](?:[ \t]*[-*_]){2,}[ \t]*$/gm, "");
	out = out.replace(/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*\|?[ \t]*$/gm, "");

	// List bullets: keep the item, drop the marker.
	out = out.replace(/^[ \t]*[-*+][ \t]+/gm, "");

	// Table pipes read as "pipe" otherwise; a pause reads better.
	out = out.replace(/\|/g, ", ");

	// Anything left over (a stray #, *, `, ~ that wasn't part of a pair) would
	// otherwise be spoken as its symbol name. Underscore is excluded here —
	// a lone one in running text is far more likely a snake_case identifier
	// than orphaned markdown, and the paired case is already handled above.
	out = out.replace(/[*`~#]/g, "");

	return out
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** The speaking triggers, as configured (a subset of `config.tts`). */
export interface SpeakModes {
	/** Speak back when the owner spoke first. */
	speakMirror: boolean;
	/** Speak when the owner asked for a voice reply on this turn. */
	speakOnRequest: boolean;
	/** Let the companion decide, via `<speak>`, when a reply is worth saying. */
	speakSometimes: boolean;
}

/** What the current turn (and the model) is asking for. */
export interface SpeakContext {
	/** The incoming turn was a voice note. */
	turnWasVoice: boolean;
	/** The channel flagged this turn as wanting a spoken reply. */
	requestedVoice: boolean;
	/** The reply (or this paragraph of it) sat inside a `<speak>` passage. */
	modelWantsSpeak: boolean;
}

/**
 * The gate. Independent triggers, OR'd: any one of them switched on and met is
 * enough. Speaking is decided here alone; whether a backend exists to do it is
 * the caller's check (see `ttsConfigured()`), so an unconfigured box simply
 * keeps sending text.
 */
export function shouldSpeak(modes: SpeakModes, ctx: SpeakContext): boolean {
	return (
		(modes.speakMirror && ctx.turnWasVoice) ||
		(modes.speakOnRequest && ctx.requestedVoice) ||
		(modes.speakSometimes && ctx.modelWantsSpeak)
	);
}
