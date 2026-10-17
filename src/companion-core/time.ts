/**
 * A sense of time between the two of you. The model only ever sees text, so on
 * its own it reads a message sent after two weeks of silence exactly like one
 * sent a minute after the last — and picks a stale thread back up as if nothing
 * happened in between. Here the gaps are measured from the stored timestamps and
 * put into words: a marker on a message that came after a pause, and a note on
 * the current turn saying how long it had been when this conversation began.
 * How to *act* on that is the persona's business (see persona.ts); this file
 * only states the facts. See docs/time-sense.md.
 */
import type { Message } from "#/db/schema.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A pause long enough to be worth marking inside a day's history. */
export const MARK_GAP_MS = HOUR;
/** A pause long enough that whatever comes next is a new conversation. */
export const SITTING_GAP_MS = 3 * HOUR;

/** How a span of time is said out loud: coarse, the way a person would put it. */
export function spanLabel(ms: number): string {
	if (ms < 90 * MINUTE) return "an hour";
	if (ms < 20 * HOUR) return `${Math.round(ms / HOUR)} hours`;
	if (ms < 36 * HOUR) return "about a day";
	if (ms < 7 * DAY) return `${Math.round(ms / DAY)} days`;
	if (ms < 13 * DAY) return "over a week";
	if (ms < 45 * DAY) return `about ${Math.round(ms / (7 * DAY))} weeks`;
	if (ms < 320 * DAY) {
		const months = Math.round(ms / (30 * DAY));
		return months <= 1 ? "about a month" : `about ${months} months`;
	}
	return ms < 540 * DAY ? "about a year" : "over a year";
}

/** The marker put in front of a message that came after a pause, or "". */
export function gapMarker(ms: number): string {
	return ms >= MARK_GAP_MS ? `[${spanLabel(ms)} later] ` : "";
}

/** "Monday 18 August, 23:10" in `tz` — enough to place a moment, no more. */
export function momentLine(d: Date, tz: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		weekday: "long",
		day: "numeric",
		month: "long",
		hour: "2-digit",
		minute: "2-digit",
	}).format(d);
}

export interface Sitting {
	/** When the current conversation began (`now` if this turn opens it). */
	startedAt: Date;
	/** The silence before it began, or null when there was never contact before. */
	gapMs: number | null;
	/** The last message before that silence. */
	lastBefore: Date | null;
}

/**
 * Find the conversation the incoming turn belongs to: walk back from `now`
 * through the newest messages until a pause of `SITTING_GAP_MS` or more. `newest`
 * is newest-first. When the walk runs off the end of the list without finding a
 * pause, the sitting is older than the window and no gap is reported.
 */
export function currentSitting(newest: Message[], now: Date): Sitting {
	let t = now.getTime();
	for (const m of newest) {
		const at = m.createdAt.getTime();
		if (t - at >= SITTING_GAP_MS)
			return { startedAt: new Date(t), gapMs: t - at, lastBefore: m.createdAt };
		t = at;
	}
	return { startedAt: new Date(t), gapMs: null, lastBefore: null };
}

/**
 * The line for the per-turn context note: how long it had been when this
 * conversation began, or how long since the last message within it. Empty when
 * the conversation is simply flowing.
 */
export function timeNote(newest: Message[], now: Date, tz: string): string {
	const sitting = currentSitting(newest, now);
	if (sitting.gapMs != null && sitting.lastBefore) {
		const last = momentLine(sitting.lastBefore, tz);
		if (sitting.startedAt.getTime() === now.getTime())
			return `Time apart: this message opens a new conversation — the last time you two talked was ${spanLabel(sitting.gapMs)} ago (${last}).`;
		return `Time apart: this conversation started at ${momentLine(
			sitting.startedAt,
			tz,
		)}, after ${spanLabel(sitting.gapMs)} without talking (last time: ${last}).`;
	}
	const last = newest[0];
	if (last) {
		const since = now.getTime() - last.createdAt.getTime();
		if (since >= MARK_GAP_MS)
			return `Time apart: ${spanLabel(since)} since the last message.`;
	}
	return "";
}

/**
 * Prefix each owner message that came after a pause with its marker. `prev` is
 * the message just before the first one in `msgs` (from an earlier day), so a
 * gap across midnight is measured too. Pure: returns new content strings.
 */
export function markGaps(msgs: Message[], prev: Message | null): string[] {
	let last = prev?.createdAt.getTime() ?? null;
	return msgs.map((m) => {
		const at = m.createdAt.getTime();
		const marker =
			m.role === "user" && last != null ? gapMarker(at - last) : "";
		last = at;
		return `${marker}${m.content}`;
	});
}
