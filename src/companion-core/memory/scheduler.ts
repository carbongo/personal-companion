/**
 * Roll-up scheduler. The nightly summary is driven here — without this nothing
 * ever calls the roll-up automatically (the web button aside). It is built to
 * survive a laptop that sleeps or is shut down at the scheduled minute:
 *
 *   - on boot it backfills any finished past day that has no summary yet, so
 *     "yesterday" gets wrapped the moment the box is back up;
 *   - a once-a-minute tick fires the nightly roll-up when the cron matches (in
 *     the configured timezone), wrapping today as the day closes;
 *   - a periodic safety tick backfills past days, covering the case where the
 *     box was asleep straight through the nightly minute and never restarted.
 *
 * The same tick also drives the optional weekly consolidation on its own cron,
 * with the same survive-downtime logic: an overdue weekly pass is caught up on
 * boot and on the safety tick.
 *
 * No daemons, no external cron — a dependency-free 5-field matcher plus a plain
 * interval. Timing and the roll-up calls are injected so it is fully testable.
 * See docs/memory.md.
 */

/** Date fields in a given IANA timezone, for matching against a cron spec. */
export function zonedParts(d: Date, tz: string) {
	const p = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(d);
	const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
	const year = get("year");
	const month = get("month");
	const day = get("day");
	// Hour can come back as "24" at midnight in some engines; normalize to 0.
	const hour = get("hour") % 24;
	const minute = get("minute");
	const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
	return { year, month, day, hour, minute, dow };
}

/** A stable "minute key" used to fire the nightly roll-up at most once a minute. */
export function minuteKey(d: Date, tz: string): string {
	const { year, month, day, hour, minute } = zonedParts(d, tz);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/** Match one cron field ("*", "5", "1-5", "*\/2", "1-9/2", "a,b,c") to a value. */
export function fieldMatches(field: string, value: number): boolean {
	return field.split(",").some((partRaw) => {
		const part = partRaw.trim();
		if (part === "*") return true;
		const [rangePart, stepPart] = part.split("/");
		const step = stepPart ? Number(stepPart) : 1;
		if (!Number.isFinite(step) || step < 1) return false;

		let lo: number;
		let hi: number;
		if (rangePart === "*") {
			// "*/n" — every n across the whole field; anchor the phase at 0.
			return value % step === 0;
		}
		if (rangePart?.includes("-")) {
			const [a, b] = rangePart.split("-").map(Number);
			lo = a as number;
			hi = b as number;
		} else {
			lo = Number(rangePart);
			hi = lo;
		}
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
		if (value < lo || value > hi) return false;
		return (value - lo) % step === 0;
	});
}

/**
 * Whether a standard 5-field cron expression (min hour day-of-month month
 * day-of-week) matches `d` in timezone `tz`. Day-of-week accepts 0 or 7 for
 * Sunday. A malformed expression never matches (the scheduler logs and skips).
 */
export function cronMatches(expr: string, d: Date, tz: string): boolean {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) return false;
	const [min, hour, dom, mon, dowField] = fields as [
		string,
		string,
		string,
		string,
		string,
	];
	const t = zonedParts(d, tz);
	// "7" is also Sunday in cron; normalize so a "7" in the field matches dow 0.
	const dowValue = t.dow;
	const dowAlt = dowField.replace(/\b7\b/g, "0");
	return (
		fieldMatches(min, t.minute) &&
		fieldMatches(hour, t.hour) &&
		fieldMatches(dom, t.day) &&
		fieldMatches(mon, t.month) &&
		(fieldMatches(dowField, dowValue) || fieldMatches(dowAlt, dowValue))
	);
}

export interface SchedulerDeps {
	cron: string;
	tz: string;
	runDailyRollup: () => Promise<number>;
	backfillPastDays: () => Promise<number>;
	/** Cron for the weekly consolidation; omit to disable the weekly pass. */
	weeklyCron?: string;
	/** The scheduled weekly consolidation (fires on `weeklyCron`). */
	runWeeklyConsolidation?: () => Promise<number>;
	/** Overdue-only weekly catch-up, for boot and the safety tick. */
	backfillWeeklyConsolidation?: () => Promise<number>;
	now?: () => Date;
	log?: (msg: string) => void;
	/** Run the safety backfill every N ticks (one tick = one minute). */
	safetyEveryTicks?: number;
}

/**
 * Drives roll-ups off a one-minute tick. Construct it, call `boot()` once at
 * startup, then `start()` to begin ticking (or call `tick()` yourself in tests).
 */
export class RollupScheduler {
	private readonly now: () => Date;
	private readonly log: (msg: string) => void;
	private readonly safetyEvery: number;
	private ticks = 0;
	private lastFired = "";
	private lastWeeklyFired = "";
	private busy = false;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly deps: SchedulerDeps) {
		this.now = deps.now ?? (() => new Date());
		this.log = deps.log ?? (() => {});
		this.safetyEvery = deps.safetyEveryTicks ?? 30;
	}

	/**
	 * Boot catch-up: wrap any finished past day that was missed while down, and
	 * run the weekly consolidation if it's overdue (the box was off through its
	 * scheduled minute).
	 */
	async boot(): Promise<void> {
		await this.guard(() => this.deps.backfillPastDays());
		if (this.deps.backfillWeeklyConsolidation)
			await this.guard(this.deps.backfillWeeklyConsolidation);
	}

	/** Handle one minute tick; fires at most one of each pass per matched minute. */
	tick(at: Date = this.now()): void {
		this.ticks++;

		// Weekly consolidation, when configured — fire once per matched minute.
		if (
			this.deps.weeklyCron &&
			this.deps.runWeeklyConsolidation &&
			cronMatches(this.deps.weeklyCron, at, this.deps.tz)
		) {
			const key = minuteKey(at, this.deps.tz);
			if (key !== this.lastWeeklyFired) {
				this.lastWeeklyFired = key;
				this.log(`[companion] weekly consolidation triggered (${key})`);
				const run = this.deps.runWeeklyConsolidation;
				void this.guard(() => run());
			}
		}

		// Nightly roll-up — fire once per matched minute.
		if (cronMatches(this.deps.cron, at, this.deps.tz)) {
			const key = minuteKey(at, this.deps.tz);
			if (key !== this.lastFired) {
				this.lastFired = key;
				this.log(`[companion] nightly roll-up triggered (${key})`);
				void this.guard(() => this.deps.runDailyRollup());
			}
			return;
		}

		// Periodic safety: backfill missed days, and catch up an overdue weekly pass.
		// Both run inside one guard, in sequence — the guard drops *concurrent* work,
		// so firing them as two separate calls would silently skip the second.
		if (this.ticks % this.safetyEvery === 0) {
			const weeklyBackfill = this.deps.backfillWeeklyConsolidation;
			void this.guard(async () => {
				let n = await this.deps.backfillPastDays();
				if (weeklyBackfill) n += await weeklyBackfill();
				return n;
			});
		}
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.tick(), 60_000);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** Never run two roll-ups at once; swallow errors so a tick never crashes. */
	private async guard(fn: () => Promise<number>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			await fn();
		} catch (err) {
			this.log(`[companion] roll-up error: ${(err as Error).message}`);
		} finally {
			this.busy = false;
		}
	}
}
