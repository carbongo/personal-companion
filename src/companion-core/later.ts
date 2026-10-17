/**
 * Getting back to them at a time they named. When the owner says when they'll be
 * back — waking at four, out of a meeting by six — the companion can end its reply
 * with a `<later at="…">why</later>` tag, and at that time it gets a moment to write
 * first, outside the usual quiet-and-chance rules of ./reach-out.ts. One plan at a
 * time; a newer tag replaces the old. The owner coming back on their own cancels it.
 * See docs/reach-out.md.
 */
import { config } from "#/config/index.ts";
import type { Message } from "#/db/schema.ts";
import { zonedParts } from "./memory/scheduler.ts";
import { deleteSetting, getSetting, setSetting } from "./memory/store.ts";
import { SITTING_GAP_MS } from "./time.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The furthest ahead a plan may be set — past that it's a calendar, not a check-in. */
export const MAX_AHEAD_MS = 7 * 24 * HOUR;
/** A plan that couldn't go out within this long after its time is dropped. */
export const STALE_AFTER_MS = 2 * HOUR;
/** The owner wrote this recently: they're here, so there's nothing to get back to. */
export const ACTIVE_MS = 30 * MINUTE;

const RE_LATER = /<later\s+at\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/later>/gi;
const RE_LATER_ANY = /<later\b[^>]*>[\s\S]*?<\/later>|<later\b[^>]*\/?>/gi;

const KEY = "reach_out_plan";

export interface Plan {
	/** When to write (epoch ms). */
	at: number;
	/** What it meant to check in about, in its own words. */
	why: string;
	/** When the plan was made (epoch ms). */
	setAt: number;
}

/** Remove every `<later>` tag, well-formed or not, so none reaches the owner. */
export function stripLaterTags(text: string): string {
	return text.replace(RE_LATER_ANY, "");
}

/** Epoch ms of a wall-clock time in `tz` (exact outside the hour a clock jumps). */
export function zonedTime(
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	tz: string,
): number {
	const want = Date.UTC(y, mo - 1, d, h, mi);
	let t = want;
	for (let i = 0; i < 2; i++) {
		const p = zonedParts(new Date(t), tz);
		t += want - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
	}
	return t;
}

/**
 * Read "YYYY-MM-DD HH:MM" (or a bare "HH:MM", meaning its next occurrence) as a
 * time in `tz`. Null when malformed, already past, or too far ahead.
 */
export function parseAt(spec: string, now: Date, tz: string): number | null {
	const full = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*$/.exec(
		spec,
	);
	const bare = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(spec);
	let at: number;
	if (full) {
		const [y, mo, d, h, mi] = full.slice(1).map(Number) as [
			number,
			number,
			number,
			number,
			number,
		];
		if (h > 23 || mi > 59) return null;
		at = zonedTime(y, mo, d, h, mi, tz);
	} else if (bare) {
		const h = Number(bare[1]);
		const mi = Number(bare[2]);
		if (h > 23 || mi > 59) return null;
		const p = zonedParts(now, tz);
		at = zonedTime(p.year, p.month, p.day, h, mi, tz);
		if (at <= now.getTime())
			at = zonedTime(p.year, p.month, p.day + 1, h, mi, tz);
	} else return null;
	const ahead = at - now.getTime();
	return ahead > 0 && ahead <= MAX_AHEAD_MS ? at : null;
}

/** Pure: the last valid `<later>` tag in a reply, as a plan, or null. */
export function parsePlan(raw: string, now: Date, tz: string): Plan | null {
	let plan: Plan | null = null;
	for (const m of raw.matchAll(RE_LATER)) {
		const at = parseAt(m[1] ?? "", now, tz);
		const why = (m[2] ?? "").trim();
		if (at != null) plan = { at, why, setAt: now.getTime() };
	}
	return plan;
}

/** Keep the plan a finished reply asked for, if it asked for one. */
export function keepPlan(raw: string, now = new Date()): void {
	if (!config.reachOut.enabled) return;
	const plan = parsePlan(raw, now, config.app.timezone);
	if (plan) setSetting(KEY, JSON.stringify(plan));
}

export function loadPlan(): Plan | null {
	const v = getSetting(KEY);
	if (!v) return null;
	try {
		const p = JSON.parse(v) as Plan;
		return Number.isFinite(p.at) && Number.isFinite(p.setAt) ? p : null;
	} catch {
		return null;
	}
}

export function clearPlan(): void {
	deleteSetting(KEY);
}

/**
 * What to do with the plan right now. "drop" when it no longer applies: the owner
 * came back on their own (a new sitting after the plan was made, or talking right
 * now), or it went stale. Pure, so every rule is testable on its own.
 */
export function planState(
	plan: Plan,
	now: Date,
	lastFromOwner: Message | null,
): "wait" | "due" | "drop" {
	const t = now.getTime();
	const owner = lastFromOwner?.createdAt.getTime() ?? 0;
	if (owner >= plan.setAt + SITTING_GAP_MS) return "drop";
	if (t < plan.at) return "wait";
	if (t - owner < ACTIVE_MS) return "drop";
	if (t - plan.at > STALE_AFTER_MS) return "drop";
	return "due";
}
