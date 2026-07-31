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
