import { beforeEach, describe, expect, it, spyOn } from "bun:test";

import { config } from "#/config/index.ts";
import { db } from "#/db/index.ts";
import {
	dailySummaries,
	type Message,
	memories,
	messages,
	settings,
} from "#/db/schema.ts";
import { provider } from "#/llm/index.ts";
import {
	backfillPastDays,
	backfillWeeklyConsolidation,
	reconcileMemories,
	reconcileSystem,
	runDailyRollup,
	runWeeklyConsolidation,
	weeklyConsolidate,
	weeklyDue,
} from "./rollup.ts";
import {
	addMemory,
	appendMessage,
	getDailySummary,
	listMemories,
	todayKey,
	upsertDailySummary,
} from "./store.ts";

const PAST = "2020-01-01";
const OLDER = "2019-12-31";

describe("roll-up resilience", () => {
	beforeEach(() => {
		db.delete(messages).run();
		db.delete(dailySummaries).run();
		// Pretend the model is up and returns a canned summary.
		spyOn(provider, "reachable").mockResolvedValue(true);
		spyOn(provider, "chat").mockResolvedValue("a summary");
	});

	it("backfillPastDays wraps finished past days but never today", async () => {
		appendMessage({ day: OLDER, role: "user", content: "hi" });
		appendMessage({ day: PAST, role: "user", content: "hey" });
		appendMessage({ day: todayKey(), role: "user", content: "today" });

		const done = await backfillPastDays();
		expect(done).toBe(2);
		expect(getDailySummary(OLDER)).not.toBeNull();
		expect(getDailySummary(PAST)).not.toBeNull();
		expect(getDailySummary(todayKey())).toBeNull(); // in-progress day left alone
	});

	it("skips a past day that already has a summary", async () => {
		appendMessage({ day: PAST, role: "user", content: "hey" });
		upsertDailySummary(PAST, "existing");

		const done = await backfillPastDays();
		expect(done).toBe(0);
		expect(getDailySummary(PAST)?.summaryMd).toBe("existing");
	});

	it("runDailyRollup also wraps today", async () => {
		appendMessage({ day: PAST, role: "user", content: "hey" });
		appendMessage({ day: todayKey(), role: "user", content: "today" });

		const done = await runDailyRollup();
		expect(done).toBe(2);
		expect(getDailySummary(todayKey())).not.toBeNull();
	});
});

describe("memory reconciliation", () => {
	beforeEach(() => {
		db.delete(messages).run();
		db.delete(dailySummaries).run();
		db.delete(memories).run();
		spyOn(provider, "reachable").mockResolvedValue(true);
	});

	it("saves new durable facts and skips ones already known", async () => {
		addMemory("Owner likes strong tea");
		spyOn(provider, "chat").mockResolvedValue(
			"<remember>Owner works at a school as a software developer</remember>\n" +
				"<remember>Owner likes strong tea</remember>", // duplicate — skipped
		);

		const { saved, forgotten } = await reconcileMemories(PAST, [] as Message[]);
		expect(saved).toEqual(["Owner works at a school as a software developer"]);
		expect(forgotten).toEqual([]);
		const all = listMemories().map((m) => m.content);
		expect(all).toContain("Owner works at a school as a software developer");
	});

	it("prompt keeps durable-only, prioritizes explicit asks, and pushes editing", () => {
		const sys = reconcileSystem([]).toLowerCase();
		// Explicit "remember this" requests win over the durability filter.
		expect(sys).toContain("explicitly asked");
		expect(sys).toContain("top priority");
		// Transient stuff is excluded.
		expect(sys).toContain("does not belong");
		expect(sys).toContain("passing moods");
		// Editing = forget the old wording + remember the corrected one.
		expect(sys).toContain("edit");
		expect(sys).toContain("forget the old wording");
		// The nuance example the owner flagged.
		expect(sys).toContain("morning");
	});

	it("drops a memory the day made wrong and saves its replacement", async () => {
		addMemory("Owner works at a school as a software developer");
		spyOn(provider, "chat").mockResolvedValue(
			"<forget>Owner works at a school as a software developer</forget>\n" +
				"<remember>Owner works at a hospital as a software developer</remember>",
		);

		const { saved, forgotten } = await reconcileMemories(PAST, [] as Message[]);
		expect(forgotten).toEqual([
			"Owner works at a school as a software developer",
		]);
		expect(saved).toEqual([
			"Owner works at a hospital as a software developer",
		]);
		const all = listMemories().map((m) => m.content);
		expect(all).toContain("Owner works at a hospital as a software developer");
		expect(all).not.toContain(
			"Owner works at a school as a software developer",
		);
	});

	it("runDailyRollup reconciles the day when MEMORY_ROLLUP_EXTRACT is on", async () => {
		const prev = config.memory.rollupExtract;
		config.memory.rollupExtract = true;
		try {
			appendMessage({ day: todayKey(), role: "user", content: "got a dog" });
			spyOn(provider, "chat").mockResolvedValue(
				"<remember>Owner has a dog named Rex</remember>",
			);

			await runDailyRollup();
			expect(listMemories().map((m) => m.content)).toContain(
				"Owner has a dog named Rex",
			);
		} finally {
			config.memory.rollupExtract = prev;
		}
	});

	it("runDailyRollup skips reconciliation when the toggle is off", async () => {
		const prev = config.memory.rollupExtract;
		config.memory.rollupExtract = false;
		try {
			appendMessage({ day: todayKey(), role: "user", content: "got a dog" });
			// Even though the model "emits" a memory tag, nothing is saved: with the
			// toggle off the roll-up only writes the summary and never reconciles.
			spyOn(provider, "chat").mockResolvedValue(
				"<remember>Owner has a dog named Rex</remember>",
			);

			await runDailyRollup();
			expect(listMemories().length).toBe(0);
		} finally {
			config.memory.rollupExtract = prev;
		}
	});
});

describe("weekly consolidation", () => {
	beforeEach(() => {
		db.delete(messages).run();
		db.delete(dailySummaries).run();
		db.delete(memories).run();
		db.delete(settings).run();
		spyOn(provider, "reachable").mockResolvedValue(true);
	});

	it("consolidates across the week's summaries and records the run", async () => {
		upsertDailySummary("2026-06-15", "Ran in the morning, felt good.");
		upsertDailySummary("2026-06-16", "Another morning run.");
		addMemory("Owner runs at night");
		spyOn(provider, "chat").mockResolvedValue(
			"<forget>Owner runs at night</forget>\n" +
				"<remember>Owner usually runs in the morning</remember>",
		);

		expect(weeklyDue()).toBe(true); // never run yet
		const { saved, forgotten } = await weeklyConsolidate();
		expect(forgotten).toEqual(["Owner runs at night"]);
		expect(saved).toEqual(["Owner usually runs in the morning"]);
		const all = listMemories().map((m) => m.content);
		expect(all).toContain("Owner usually runs in the morning");
		expect(all).not.toContain("Owner runs at night");
		expect(weeklyDue()).toBe(false); // recorded as run today
	});

	it("is a no-op with no summaries yet (and records nothing)", async () => {
		spyOn(provider, "chat").mockResolvedValue(
			"<remember>Owner has a cat</remember>",
		);
		const { saved, forgotten } = await weeklyConsolidate();
		expect(saved).toEqual([]);
		expect(forgotten).toEqual([]);
		expect(listMemories().length).toBe(0); // model was never consulted
		expect(weeklyDue()).toBe(true); // no run recorded
	});

	it("runWeeklyConsolidation no-ops when MEMORY_WEEKLY is off", async () => {
		const prevW = config.memory.weekly;
		const prevR = config.memory.rollupExtract;
		config.memory.weekly = false;
		config.memory.rollupExtract = true;
		try {
			upsertDailySummary("2026-06-15", "Another morning run.");
			addMemory("Owner runs at night");
			spyOn(provider, "chat").mockResolvedValue(
				"<forget>Owner runs at night</forget>",
			);

			expect(await runWeeklyConsolidation()).toBe(0);
			// Nothing touched: the night memory survives, the pass never recorded.
			expect(listMemories().map((m) => m.content)).toContain(
				"Owner runs at night",
			);
			expect(weeklyDue()).toBe(true);
		} finally {
			config.memory.weekly = prevW;
			config.memory.rollupExtract = prevR;
		}
	});

	it("backfillWeeklyConsolidation runs only when overdue", async () => {
		const prevW = config.memory.weekly;
		const prevR = config.memory.rollupExtract;
		config.memory.weekly = true;
		config.memory.rollupExtract = true;
		try {
			upsertDailySummary("2026-06-15", "Another morning run.");
			spyOn(provider, "chat").mockResolvedValue(
				"<remember>Owner usually runs in the morning</remember>",
			);

			expect(await backfillWeeklyConsolidation()).toBe(1); // never run → catches up
			expect(weeklyDue()).toBe(false);
			expect(await backfillWeeklyConsolidation()).toBe(0); // not overdue → no-op
		} finally {
			config.memory.weekly = prevW;
			config.memory.rollupExtract = prevR;
		}
	});
});
