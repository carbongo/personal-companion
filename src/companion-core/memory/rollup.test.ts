import { beforeEach, describe, expect, it, spyOn } from "bun:test";

import { db } from "#/db/index.ts";
import { dailySummaries, messages } from "#/db/schema.ts";
import { provider } from "#/llm/index.ts";
import { backfillPastDays, runDailyRollup } from "./rollup.ts";
import {
	appendMessage,
	getDailySummary,
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
