import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { config } from "#/config/index.ts";
import { db } from "#/db/index.ts";
import { type Message, messages, settings } from "#/db/schema.ts";
import { provider } from "#/llm/index.ts";
import {
	draftReachOut,
	logReachOut,
	type ReachOutDraft,
	respond,
} from "./engine.ts";
import { appendMessage, getSetting, todayKey } from "./memory/store.ts";
import {
	inHours,
	PASS_COOLDOWN_MS,
	ReachOut,
	type ReachOutState,
	reachOutDue,
} from "./reach-out.ts";

const HOUR = 3_600_000;
// 14:00 UTC — inside the default 10-21 window when tz is UTC.
const NOW = new Date("2030-06-15T14:00:00Z");

function msg(role: Message["role"], ago: number): Message {
	return {
		id: 1,
		day: "2030-06-15",
		role,
		kind: "text",
		content: "…",
		mediaUrl: null,
		createdAt: new Date(NOW.getTime() - ago),
	};
}

function state(over: Partial<ReachOutState> = {}): ReachOutState {
	const owner = msg("user", 30 * HOUR);
	return {
		now: NOW,
		last: owner,
		lastFromOwner: owner,
		lastSentAt: null,
		lastPassAt: null,
		hours: "10-21",
		afterHours: 24,
		tz: "UTC",
		...over,
	};
}

describe("inHours", () => {
	it("handles plain and midnight-wrapping windows", () => {
		expect(inHours(10, "10-21")).toBe(true);
		expect(inHours(21, "10-21")).toBe(false);
		expect(inHours(23, "22-7")).toBe(true);
		expect(inHours(3, "22-7")).toBe(true);
		expect(inHours(12, "22-7")).toBe(false);
		expect(inHours(12, "nonsense")).toBe(false);
	});
});

describe("reachOutDue", () => {
	it("is due after a long enough quiet, in waking hours", () => {
		const r = reachOutDue(state());
		expect(r.due).toBe(true);
		expect(r.silenceMs).toBe(30 * HOUR);
	});

	it("never cold-opens a conversation that never happened", () => {
		expect(reachOutDue(state({ last: null, lastFromOwner: null })).due).toBe(
			false,
		);
	});

	it("waits for the quiet to be long enough", () => {
		const recent = msg("user", 3 * HOUR);
		expect(
			reachOutDue(state({ last: recent, lastFromOwner: recent })).due,
		).toBe(false);
	});

	it("never writes twice without an answer", () => {
		const sentAfterOwner = NOW.getTime() - 26 * HOUR;
		expect(reachOutDue(state({ lastSentAt: sentAfterOwner })).due).toBe(false);
		const sentBeforeOwner = NOW.getTime() - 40 * HOUR;
		expect(reachOutDue(state({ lastSentAt: sentBeforeOwner })).due).toBe(true);
	});

	it("rests after deciding there was nothing to say", () => {
		const justPassed = NOW.getTime() - HOUR;
		expect(reachOutDue(state({ lastPassAt: justPassed })).due).toBe(false);
		const longAgo = NOW.getTime() - PASS_COOLDOWN_MS - HOUR;
		expect(reachOutDue(state({ lastPassAt: longAgo })).due).toBe(true);
	});

	it("keeps quiet outside its hours", () => {
		expect(reachOutDue(state({ hours: "6-9" })).due).toBe(false);
	});
});

describe("ReachOut.tick", () => {
	const prevHours = config.reachOut.hours;
	afterEach(() => {
		config.reachOut.hours = prevHours;
	});
	beforeEach(() => {
		db.delete(messages).run();
		db.delete(settings).run();
		config.reachOut.hours = "0-24";
		// The owner wrote two days ago and was answered.
		const twoDays = new Date(Date.now() - 48 * HOUR);
		db.insert(messages)
			.values([
				{
					day: "2020-01-01",
					role: "user",
					content: "talk soon",
					createdAt: twoDays,
				},
				{
					day: "2020-01-01",
					role: "assistant",
					content: "bye",
					createdAt: twoDays,
				},
			])
			.run();
	});

	const draft: ReachOutDraft = { text: "how did it go?", spoken: false };

	it("sends, logs, and then waits for an answer", async () => {
		const sent: ReachOutDraft[] = [];
		const ro = new ReachOut({
			draft: async () => draft,
			send: async (d) => {
				sent.push(d);
				return "text";
			},
			log: logReachOut,
			random: () => 0,
		});
		expect(await ro.tick()).toBe("sent");
		expect(sent).toEqual([draft]);
		expect(getSetting("reach_out_last_sent_at")).not.toBeNull();
		// Its own message is now the newest, so the quiet is over until the owner answers.
		expect(await ro.tick()).toBe("skip");
	});

	it("records a pass so it doesn't ask itself again right away", async () => {
		const ro = new ReachOut({
			draft: async () => null,
			send: async () => "text",
			log: () => {},
			random: () => 0,
		});
		expect(await ro.tick()).toBe("pass");
		expect(await ro.tick()).toBe("skip");
	});

	it("leaves the moment to chance so it never lands like clockwork", async () => {
		const ro = new ReachOut({
			draft: async () => draft,
			send: async () => "text",
			log: () => {},
			random: () => 0.99,
		});
		expect(await ro.tick()).toBe("skip");
	});
});

describe("draftReachOut / the day it opens", () => {
	beforeEach(() => {
		db.delete(messages).run();
		spyOn(provider, "reachable").mockResolvedValue(true);
	});

	it("treats <pass/> as nothing to say", async () => {
		spyOn(provider, "chat").mockResolvedValue("<pass/>");
		expect(await draftReachOut(30 * HOUR)).toBeNull();
	});

	it("returns the message, asking for voice only when it can speak", async () => {
		spyOn(provider, "chat").mockResolvedValue("<speak>hey, you there?</speak>");
		const d = await draftReachOut(30 * HOUR);
		expect(d?.text).toBe("hey, you there?");
	});

	it("keeps its own first message in view when the owner replies", async () => {
		appendMessage({
			day: todayKey(),
			role: "assistant",
			content: "how did it go?",
		});
		const chat = spyOn(provider, "chat").mockResolvedValue("glad to hear it");
		await respond({ text: "it went well" });
		const sent = chat.mock.calls.at(-1)?.[0] ?? [];
		const contents = sent.map((m) => m.content);
		expect(contents).toContain("[you messaged first]");
		expect(contents).toContain("how did it go?");
	});
});
