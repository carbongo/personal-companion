import { beforeEach, describe, expect, it, spyOn } from "bun:test";

import { db } from "#/db/index.ts";
import { type Digest, dailySummaries, digests } from "#/db/schema.ts";
import { provider } from "#/llm/index.ts";
import {
	compactPeriods,
	monthEnd,
	pendingPeriods,
	selectDigests,
	weekStart,
} from "./digest.ts";
import { getDigest, upsertDailySummary } from "./store.ts";

function digest(kind: Digest["kind"], start: string, end: string): Digest {
	return {
		kind,
		start,
		end,
		summaryMd: `${kind} ${start}`,
		createdAt: new Date(),
	};
}

describe("calendar math", () => {
	it("finds the Monday of a week and the end of a month", () => {
		expect(weekStart("2030-01-02")).toBe("2029-12-31"); // a Wednesday
		expect(weekStart("2029-12-31")).toBe("2029-12-31"); // a Monday
		expect(weekStart("2030-01-06")).toBe("2029-12-31"); // a Sunday
		expect(monthEnd("2028-02-10")).toBe("2028-02-29");
		expect(monthEnd("2030-04-30")).toBe("2030-04-30");
	});
});

describe("pendingPeriods", () => {
	it("lists only finished weeks and months that lack a digest", () => {
		const days = ["2030-03-04", "2030-03-05", "2030-03-27"];
		const has = (kind: Digest["kind"], start: string) =>
			kind === "week" && start === "2030-03-04";
		const pending = pendingPeriods(days, "2030-03-28", has);
		// March is still in progress; its week of the 4th already has a digest;
		// the week of the 25th is still running.
		expect(pending).toEqual([]);

		const later = pendingPeriods(days, "2030-04-02", has);
		expect(later).toEqual([
			{ kind: "month", start: "2030-03-01", end: "2030-03-31" },
			{ kind: "week", start: "2030-03-25", end: "2030-03-31" },
		]);
	});
});

describe("selectDigests", () => {
	const weeks = [
		digest("week", "2030-05-27", "2030-06-02"),
		digest("week", "2030-05-20", "2030-05-26"),
		digest("week", "2030-05-13", "2030-05-19"),
		digest("week", "2030-05-06", "2030-05-12"),
		digest("week", "2030-04-29", "2030-05-05"),
		digest("week", "2030-04-22", "2030-04-28"),
	];
	const months = [
		digest("month", "2030-05-01", "2030-05-31"),
		digest("month", "2030-04-01", "2030-04-30"),
		digest("month", "2030-03-01", "2030-03-31"),
	];

	it("walks back from the days through weeks to a month boundary, then months", () => {
		const picked = selectDigests("2030-06-03", weeks, months, 2, 6);
		// Two weeks reach 2030-05-20; it keeps going to 2030-04-29, where May
		// begins within the week, so April is the first month that fits.
		expect(picked.weeks.map((w) => w.start)).toEqual([
			"2030-04-29",
			"2030-05-06",
			"2030-05-13",
			"2030-05-20",
			"2030-05-27",
		]);
		expect(picked.months.map((m) => m.start)).toEqual([
			"2030-03-01",
			"2030-04-01",
		]);
	});

	it("stops at the week limit when no months are wanted", () => {
		const picked = selectDigests("2030-06-03", weeks, months, 2, 0);
		expect(picked.weeks).toHaveLength(2);
		expect(picked.months).toEqual([]);
	});

	it("skips digests the daily summaries already cover", () => {
		const picked = selectDigests("2030-05-14", weeks, months, 1, 0);
		expect(picked.weeks.map((w) => w.start)).toEqual(["2030-05-13"]);
	});
});

describe("compactPeriods", () => {
	beforeEach(() => {
		db.delete(dailySummaries).run();
		db.delete(digests).run();
		spyOn(provider, "chat").mockResolvedValue("- the specifics");
	});

	it("writes a digest for each finished week and month, once", async () => {
		upsertDailySummary("2020-03-03", "a day");
		upsertDailySummary("2020-03-04", "another day");
		expect(await compactPeriods()).toBe(2);
		expect(getDigest("week", "2020-03-02")?.summaryMd).toBe("- the specifics");
		expect(getDigest("month", "2020-03-01")?.end).toBe("2020-03-31");
		expect(await compactPeriods()).toBe(0);
	});
});
