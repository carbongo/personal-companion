import { describe, expect, it } from "bun:test";

import {
	cronMatches,
	fieldMatches,
	minuteKey,
	RollupScheduler,
	zonedParts,
} from "./scheduler.ts";

describe("fieldMatches", () => {
	it("wildcard, single, range, list, and step", () => {
		expect(fieldMatches("*", 17)).toBe(true);
		expect(fieldMatches("5", 5)).toBe(true);
		expect(fieldMatches("5", 6)).toBe(false);
		expect(fieldMatches("1-5", 3)).toBe(true);
		expect(fieldMatches("1-5", 6)).toBe(false);
		expect(fieldMatches("1,3,5", 3)).toBe(true);
		expect(fieldMatches("1,3,5", 4)).toBe(false);
		expect(fieldMatches("*/15", 30)).toBe(true);
		expect(fieldMatches("*/15", 31)).toBe(false);
		expect(fieldMatches("0-10/2", 4)).toBe(true);
		expect(fieldMatches("0-10/2", 5)).toBe(false);
	});
});

describe("zonedParts", () => {
	it("reads wall-clock fields in the target timezone", () => {
		// 14:55Z is 23:55 in Tokyo (UTC+9, no DST), on a Wednesday.
		const d = new Date("2026-06-24T14:55:00Z");
		const p = zonedParts(d, "Asia/Tokyo");
		expect(p.hour).toBe(23);
		expect(p.minute).toBe(55);
		expect(p.day).toBe(24);
		expect(p.dow).toBe(3); // Wed
	});
});

describe("cronMatches", () => {
	const tz = "Asia/Tokyo";
	it("matches the nightly default at the local minute", () => {
		expect(
			cronMatches("55 23 * * *", new Date("2026-06-24T14:55:00Z"), tz),
		).toBe(true);
		expect(
			cronMatches("55 23 * * *", new Date("2026-06-24T14:50:00Z"), tz),
		).toBe(false);
	});
	it("respects day-of-week, with 7 == Sunday", () => {
		// 2026-06-28 is a Sunday; 01:00Z is 10:00 in Tokyo.
		const sun = new Date("2026-06-28T01:00:00Z");
		expect(cronMatches("0 10 * * 0", sun, tz)).toBe(true);
		expect(cronMatches("0 10 * * 7", sun, tz)).toBe(true);
		expect(cronMatches("0 10 * * 1", sun, tz)).toBe(false);
	});
	it("rejects malformed expressions", () => {
		expect(cronMatches("nonsense", new Date(), tz)).toBe(false);
		expect(cronMatches("1 2 3", new Date(), tz)).toBe(false);
	});
});

describe("minuteKey", () => {
	it("is stable within a minute and changes across minutes", () => {
		const tz = "UTC";
		expect(minuteKey(new Date("2026-06-24T10:30:00Z"), tz)).toBe(
			minuteKey(new Date("2026-06-24T10:30:59Z"), tz),
		);
		expect(minuteKey(new Date("2026-06-24T10:30:00Z"), tz)).not.toBe(
			minuteKey(new Date("2026-06-24T10:31:00Z"), tz),
		);
	});
});

describe("RollupScheduler", () => {
	const tz = "Asia/Tokyo";
	const match = new Date("2026-06-24T14:55:00Z"); // 23:55 Tokyo
	const noMatch = new Date("2026-06-24T14:50:00Z");

	function spy() {
		const state = { n: 0 };
		const fn = async () => {
			state.n++;
			return 0;
		};
		return { fn, state };
	}
	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("boot runs the past-day backfill", async () => {
		const backfill = spy();
		const nightly = spy();
		const s = new RollupScheduler({
			cron: "55 23 * * *",
			tz,
			runDailyRollup: nightly.fn,
			backfillPastDays: backfill.fn,
		});
		await s.boot();
		expect(backfill.state.n).toBe(1);
		expect(nightly.state.n).toBe(0);
	});

	it("fires the nightly roll-up once per matched minute", async () => {
		const backfill = spy();
		const nightly = spy();
		const s = new RollupScheduler({
			cron: "55 23 * * *",
			tz,
			runDailyRollup: nightly.fn,
			backfillPastDays: backfill.fn,
		});
		s.tick(match);
		s.tick(match); // same minute — must not fire again
		await flush();
		expect(nightly.state.n).toBe(1);
	});

	it("runs the safety backfill every N ticks when idle", async () => {
		const backfill = spy();
		const nightly = spy();
		const s = new RollupScheduler({
			cron: "55 23 * * *",
			tz,
			runDailyRollup: nightly.fn,
			backfillPastDays: backfill.fn,
			safetyEveryTicks: 3,
		});
		s.tick(noMatch);
		s.tick(noMatch);
		await flush();
		expect(backfill.state.n).toBe(0);
		s.tick(noMatch); // 3rd idle tick → safety backfill
		await flush();
		expect(backfill.state.n).toBe(1);
		expect(nightly.state.n).toBe(0);
	});
});
