/**
 * Writing first. Every so often the companion considers messaging the owner on
 * its own, the way a friend does — but only when the owner has been quiet for a
 * while, only in waking hours, never twice without an answer, and only when it
 * has a real reason (the engine asks; "nothing to say" is a valid answer). The
 * timing is deliberately loose, so it never lands at the same minute twice.
 *
 * This file only decides *when* to consider it. What to say is the engine's
 * (`draftReachOut`), and delivery is a channel's (Telegram's `sendToOwner`).
 * See docs/reach-out.md.
 */
import { config } from "#/config/index.ts";
import type { Message } from "#/db/schema.ts";
import type { ReachOutDraft } from "./engine.ts";
import { zonedParts } from "./memory/scheduler.ts";
import { getSetting, latestMessages, setSetting } from "./memory/store.ts";

const HOUR = 3_600_000;

/** How often it considers writing. */
export const TICK_MS = 30 * 60_000;
/** Chance that an eligible tick actually asks — spreads the moment out. */
export const CONSIDER_CHANCE = 0.25;
/** After deciding there's nothing to say, how long before it asks itself again. */
export const PASS_COOLDOWN_MS = 12 * HOUR;

/** Setting keys (epoch ms as strings). */
const LAST_SENT = "reach_out_last_sent_at";
const LAST_PASS = "reach_out_last_pass_at";

/** Parse "10-21" into an hour window; malformed means "never". */
export function parseHours(spec: string): { from: number; to: number } | null {
	const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(spec);
	if (!m) return null;
	const from = Number(m[1]);
	const to = Number(m[2]);
	if (from > 23 || to > 24) return null;
	return { from, to };
}

/** Whether `hour` falls in the window (end exclusive; "22-7" wraps midnight). */
export function inHours(hour: number, spec: string): boolean {
	const w = parseHours(spec);
	if (!w) return false;
	return w.from <= w.to
		? hour >= w.from && hour < w.to
		: hour >= w.from || hour < w.to;
}

export interface ReachOutState {
	now: Date;
	/** Newest message of any kind, or null when there was never contact. */
	last: Message | null;
	/** Newest owner message. */
	lastFromOwner: Message | null;
	lastSentAt: number | null;
	lastPassAt: number | null;
	hours: string;
	afterHours: number;
	tz: string;
}

/**
 * Whether it may consider writing right now, and how long the quiet has been.
 * Pure, so every rule is testable on its own.
 */
export function reachOutDue(s: ReachOutState): {
	due: boolean;
	silenceMs: number;
} {
	const no = { due: false, silenceMs: 0 };
	// Never a cold open: there has to be a relationship to reach back into.
	if (!s.last || !s.lastFromOwner) return no;
	const silenceMs = s.now.getTime() - s.last.createdAt.getTime();
	if (silenceMs < s.afterHours * HOUR) return no;
	// Never twice without an answer.
	if (
		s.lastSentAt != null &&
		s.lastSentAt >= s.lastFromOwner.createdAt.getTime()
	)
		return no;
	if (s.lastPassAt != null && s.now.getTime() - s.lastPassAt < PASS_COOLDOWN_MS)
		return no;
	if (!inHours(zonedParts(s.now, s.tz).hour, s.hours)) return no;
	return { due: true, silenceMs };
}

export interface ReachOutDeps {
	draft: (silenceMs: number) => Promise<ReachOutDraft | null>;
	/** Deliver it; resolves to how it went out, or null if it couldn't be sent. */
	send: (draft: ReachOutDraft) => Promise<"text" | "voice" | null>;
	/** Record a delivered message in the log. */
	log: (draft: ReachOutDraft, kind: "text" | "voice") => void;
	now?: () => Date;
	random?: () => number;
	info?: (msg: string) => void;
}

const asNum = (v: string | null): number | null =>
	v != null && Number.isFinite(Number(v)) ? Number(v) : null;

export class ReachOut {
	private readonly now: () => Date;
	private readonly random: () => number;
	private readonly info: (msg: string) => void;
	private busy = false;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly deps: ReachOutDeps) {
		this.now = deps.now ?? (() => new Date());
		this.random = deps.random ?? Math.random;
		this.info = deps.info ?? (() => {});
	}

	/** One consideration. Returns what happened, for logs and tests. */
	async tick(): Promise<"skip" | "pass" | "sent" | "failed"> {
		if (this.busy) return "skip";
		this.busy = true;
		try {
			const now = this.now();
			const recent = latestMessages(200);
			const { due, silenceMs } = reachOutDue({
				now,
				last: recent[0] ?? null,
				lastFromOwner: recent.find((m) => m.role === "user") ?? null,
				lastSentAt: asNum(getSetting(LAST_SENT)),
				lastPassAt: asNum(getSetting(LAST_PASS)),
				hours: config.reachOut.hours,
				afterHours: config.reachOut.afterHours,
				tz: config.app.timezone,
			});
			if (!due || this.random() >= CONSIDER_CHANCE) return "skip";

			const draft = await this.deps.draft(silenceMs);
			if (!draft) {
				setSetting(LAST_PASS, String(now.getTime()));
				this.info("[reach-out] considered writing first; nothing to say");
				return "pass";
			}
			const kind = await this.deps.send(draft);
			if (!kind) return "failed";
			this.deps.log(draft, kind);
			setSetting(LAST_SENT, String(this.now().getTime()));
			this.info(`[reach-out] wrote first (${kind})`);
			return "sent";
		} catch (err) {
			this.info(`[reach-out] error: ${(err as Error).message}`);
			return "failed";
		} finally {
			this.busy = false;
		}
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), TICK_MS);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
