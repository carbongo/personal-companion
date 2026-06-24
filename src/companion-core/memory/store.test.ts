import { describe, expect, it } from "bun:test";

import {
	addMemory,
	appendMessage,
	getCore,
	getDailySummary,
	listMemories,
	messagesForDay,
	recentSummariesBefore,
	setCore,
	upsertDailySummary,
} from "./store.ts";

// A far-future day keeps this test isolated from anything else in the suite.
const DAY = "2099-02-03";

describe("memory store (in-memory db)", () => {
	it("round-trips a day's messages in order", () => {
		appendMessage({ day: DAY, role: "user", content: "hi" });
		appendMessage({ day: DAY, role: "assistant", content: "hello" });
		expect(messagesForDay(DAY).map((m) => m.content)).toEqual(["hi", "hello"]);
	});

	it("stores and overwrites the Core singleton", () => {
		setCore("the spine");
		expect(getCore()).toBe("the spine");
	});

	it("adds and lists discrete memories", () => {
		addMemory("remembers the cat's name", "pets");
		expect(
			listMemories().some((m) => m.content === "remembers the cat's name"),
		).toBe(true);
	});

	it("upserts daily summaries and reads them back by range", () => {
		upsertDailySummary("2099-02-01", "a quiet day");
		expect(getDailySummary("2099-02-01")?.summaryMd).toBe("a quiet day");
		const recent = recentSummariesBefore("2099-02-05", 7);
		expect(recent.some((s) => s.day === "2099-02-01")).toBe(true);
	});
});
