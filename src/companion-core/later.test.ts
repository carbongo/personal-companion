import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { config } from "#/config/index.ts";
import { db } from "#/db/index.ts";
import { type Message, messages, settings } from "#/db/schema.ts";
import { provider } from "#/llm/index.ts";
import { logReachOut, respond } from "./engine.ts";
import {
	keepPlan,
	loadPlan,
	type Plan,
	parseAt,
	parsePlan,
	planState,
	stripLaterTags,
} from "./later.ts";
import { ReachOut } from "./reach-out.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 07:30 at UTC+5.
const NOW = new Date("2030-06-15T02:30:00Z");
const TZ = "Asia/Tashkent";

function owner(at: number): Message {
	return {
		id: 1,
		day: "2030-06-15",
		role: "user",
		kind: "text",
		content: "…",
		mediaUrl: null,
		createdAt: new Date(at),
	};
}

describe("parseAt", () => {
	it("reads a full local time in the owner's timezone", () => {
		expect(parseAt("2030-06-15 16:00", NOW, TZ)).toBe(
			Date.parse("2030-06-15T11:00:00Z"),
		);
	});

	it("reads a bare time as its next occurrence", () => {
		expect(parseAt("16:00", NOW, TZ)).toBe(Date.parse("2030-06-15T11:00:00Z"));
		expect(parseAt("06:00", NOW, TZ)).toBe(Date.parse("2030-06-16T01:00:00Z"));
	});

	it("refuses the past, the far future, and nonsense", () => {
		expect(parseAt("2030-06-15 07:00", NOW, TZ)).toBeNull();
		expect(parseAt("2030-07-15 07:00", NOW, TZ)).toBeNull();
		expect(parseAt("25:00", NOW, TZ)).toBeNull();
		expect(parseAt("soon", NOW, TZ)).toBeNull();
	});
});

describe("parsePlan / stripLaterTags", () => {
	const reply = `Sleep well.\n<later at="2030-06-15 16:00">ask if they woke at four</later>`;

	it("takes the time and the reason", () => {
		expect(parsePlan(reply, NOW, TZ)).toEqual({
			at: Date.parse("2030-06-15T11:00:00Z"),
			why: "ask if they woke at four",
			setAt: NOW.getTime(),
		});
	});

	it("never shows the tag, even a malformed one", () => {
		expect(stripLaterTags(reply).trim()).toBe("Sleep well.");
		expect(stripLaterTags('hi <later at="whenever">x</later>').trim()).toBe(
			"hi",
		);
	});
});

describe("planState", () => {
	const plan: Plan = {
		at: NOW.getTime() + 8 * HOUR,
		why: "",
		setAt: NOW.getTime(),
	};
	const at = (ms: number) => new Date(plan.at + ms);

	it("waits until the time, then is due", () => {
		expect(planState(plan, NOW, owner(NOW.getTime() - MINUTE))).toBe("wait");
		expect(planState(plan, at(0), owner(NOW.getTime() - MINUTE))).toBe("due");
	});

	it("keeps through a goodnight in the same sitting", () => {
		expect(planState(plan, at(0), owner(NOW.getTime() + 5 * MINUTE))).toBe(
			"due",
		);
	});

	it("drops when the owner came back on their own, or it went stale", () => {
		expect(planState(plan, NOW, owner(NOW.getTime() + 5 * HOUR))).toBe("drop");
		expect(planState(plan, at(3 * HOUR), owner(NOW.getTime()))).toBe("drop");
	});
});

describe("ReachOut.tickPlan", () => {
	const prevReach = { ...config.reachOut };
	const prevTz = config.app.timezone;
	beforeEach(() => {
		db.delete(messages).run();
		db.delete(settings).run();
		config.reachOut.enabled = true;
		config.app.timezone = "UTC";
		spyOn(provider, "reachable").mockResolvedValue(true);
	});
	afterEach(() => {
		Object.assign(config.reachOut, prevReach);
		config.app.timezone = prevTz;
	});

	it("keeps the plan a reply asks for, and writes at that time", async () => {
		// Twelve hours from now, as a bare clock time.
		const hh = String((new Date().getUTCHours() + 12) % 24).padStart(2, "0");
		spyOn(provider, "chat").mockResolvedValue(
			`Night!\n<later at="${hh}:00">ask how they slept</later>`,
		);
		const { reply } = await respond({ text: "off to sleep" });
		expect(reply).toBe("Night!");
		const plan = loadPlan();
		expect(plan?.why).toBe("ask how they slept");

		const asked: (Plan | undefined)[] = [];
		let clock = new Date();
		const ro = new ReachOut({
			draft: async (_silence, p) => {
				asked.push(p);
				return { text: "up yet?", spoken: false };
			},
			send: async () => "text",
			log: logReachOut,
			now: () => clock,
		});
		expect(await ro.tickPlan()).toBe("skip");
		clock = new Date((plan?.at ?? 0) + MINUTE);
		expect(await ro.tickPlan()).toBe("sent");
		expect(asked[0]?.why).toBe("ask how they slept");
		expect(loadPlan()).toBeNull();
	});

	it("keeps nothing when writing first is off", () => {
		config.reachOut.enabled = false;
		keepPlan('<later at="23:59">x</later>');
		expect(loadPlan()).toBeNull();
	});
});
