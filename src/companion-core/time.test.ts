import { describe, expect, it } from "bun:test";

import type { Message } from "#/db/schema.ts";
import {
	currentSitting,
	gapMarker,
	markGaps,
	spanLabel,
	timeNote,
} from "./time.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date("2030-06-15T12:00:00Z");

let nextId = 1;
function msg(role: Message["role"], ago: number, content = "…"): Message {
	return {
		id: nextId++,
		day: "2030-06-15",
		role,
		kind: "text",
		content,
		mediaUrl: null,
		createdAt: new Date(NOW.getTime() - ago),
	};
}

describe("spanLabel", () => {
	it("speaks in coarse, human units", () => {
		expect(spanLabel(70 * MIN)).toBe("an hour");
		expect(spanLabel(5 * HOUR)).toBe("5 hours");
		expect(spanLabel(28 * HOUR)).toBe("about a day");
		expect(spanLabel(4 * DAY)).toBe("4 days");
		expect(spanLabel(9 * DAY)).toBe("over a week");
		expect(spanLabel(21 * DAY)).toBe("about 3 weeks");
		expect(spanLabel(60 * DAY)).toBe("about 2 months");
		expect(spanLabel(400 * DAY)).toBe("about a year");
	});
});

describe("gapMarker", () => {
	it("marks only a real pause", () => {
		expect(gapMarker(20 * MIN)).toBe("");
		expect(gapMarker(3 * HOUR)).toBe("[3 hours later] ");
	});
});

describe("currentSitting / timeNote", () => {
	it("reports a new conversation opened by this message after a long gap", () => {
		const newest = [msg("assistant", 59 * DAY), msg("user", 59 * DAY + MIN)];
		const sitting = currentSitting(newest, NOW);
		expect(sitting.startedAt).toEqual(NOW);
		expect(sitting.gapMs).toBe(59 * DAY);
		const note = timeNote(newest, NOW, "UTC");
		expect(note).toContain("opens a new conversation");
		expect(note).toContain("about 2 months ago");
	});

	it("keeps reporting the opening gap for the rest of that conversation", () => {
		const newest = [
			msg("assistant", 5 * MIN),
			msg("user", 6 * MIN),
			msg("assistant", 5 * DAY),
		];
		const note = timeNote(newest, NOW, "UTC");
		expect(note).toContain("this conversation started at");
		expect(note).toContain("after 5 days without talking");
	});

	it("notes a shorter pause inside a flowing conversation", () => {
		const newest = [msg("assistant", 2 * HOUR), msg("user", 2 * HOUR + MIN)];
		expect(timeNote(newest, NOW, "UTC")).toBe(
			"Time apart: 2 hours since the last message.",
		);
	});

	it("says nothing while the conversation is simply flowing", () => {
		expect(timeNote([msg("assistant", 2 * MIN)], NOW, "UTC")).toBe("");
	});

	it("reports no gap when there was never any contact before", () => {
		expect(currentSitting([], NOW).gapMs).toBeNull();
		expect(timeNote([], NOW, "UTC")).toBe("");
	});
});

describe("markGaps", () => {
	it("marks owner messages after a pause, across the day boundary too", () => {
		const prev = msg("assistant", 3 * DAY);
		const day = [
			msg("user", 2 * HOUR, "hey"),
			msg("assistant", 2 * HOUR - MIN, "hi"),
			msg("user", 2 * HOUR - 2 * MIN, "so"),
			msg("user", 0, "back"),
		];
		expect(markGaps(day, prev)).toEqual([
			"[3 days later] hey",
			"hi",
			"so",
			"[2 hours later] back",
		]);
	});

	it("never marks the companion's own messages", () => {
		const day = [msg("user", 5 * HOUR), msg("assistant", 0, "late reply")];
		expect(markGaps(day, null)[1]).toBe("late reply");
	});
});
