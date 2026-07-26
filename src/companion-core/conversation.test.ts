import { describe, expect, it } from "bun:test";

import {
	buildConversationNote,
	clingingTopics,
	type Exchange,
	isEchoing,
	questionStreak,
} from "./conversation.ts";

const user = (content: string): Exchange => ({ role: "user", content });
const bot = (content: string): Exchange => ({ role: "assistant", content });

describe("clingingTopics", () => {
	it("names a topic the companion keeps raising and the owner has dropped", () => {
		const day: Exchange[] = [
			user("been thinking about starting pottery classes"),
			bot("pottery is a good instinct. what's pulling you toward pottery?"),
			user("dunno. anyway the flat viewing is tomorrow"),
			bot("noted. still, pottery would suit you — have you looked at studios?"),
			user("maybe. i should sleep"),
			bot("sleep well. think about the pottery studios though."),
		];
		expect(clingingTopics(day)).toContain("pottery");
	});

	it("stays quiet while the owner is still on the topic", () => {
		const day: Exchange[] = [
			user("been thinking about pottery classes"),
			bot("pottery suits you. what's pulling you toward it?"),
			user("i like pottery because it's slow"),
			bot("that slowness is the whole appeal of pottery."),
		];
		expect(clingingTopics(day)).toEqual([]);
	});

	it("stays quiet once the companion has actually let it go", () => {
		const day: Exchange[] = [
			user("thinking about pottery classes"),
			bot("pottery suits you — what's pulling you toward pottery?"),
			user("dunno. flat viewing tomorrow"),
			bot("pottery would suit you though."),
			user("mm"),
			bot("fair enough. how's the flat looking — anything promising?"),
		];
		expect(clingingTopics(day)).toEqual([]);
	});

	it("ignores a single mention", () => {
		const day: Exchange[] = [
			user("long day"),
			bot("sounds it. the marathon training must be eating your evenings."),
		];
		expect(clingingTopics(day)).toEqual([]);
	});
});

describe("questionStreak", () => {
	it("counts consecutive companion messages ending in a question", () => {
		const day: Exchange[] = [
			bot("just a statement."),
			user("ok"),
			bot("how did that land?"),
			user("fine"),
			bot("and the rest of it?"),
		];
		expect(questionStreak(day)).toBe(2);
	});

	it("resets when the companion says something plain", () => {
		expect(
			questionStreak([bot("how's it going?"), user("ok"), bot("good.")]),
		).toBe(0);
	});
});

describe("isEchoing", () => {
	it("catches a reply made of the owner's own words", () => {
		const day: Exchange[] = [
			user(
				"the deployment broke because the migration ran twice against production",
			),
			bot(
				"so the deployment broke because the migration ran twice against production. that sounds rough.",
			),
		];
		expect(isEchoing(day)).toBe(true);
	});

	it("leaves a reply that adds something of its own alone", () => {
		const day: Exchange[] = [
			user(
				"the deployment broke because the migration ran twice against production",
			),
			bot(
				"double-run migrations usually mean the advisory lock isn't held long enough. worth checking whether the runner retries on timeout.",
			),
		];
		expect(isEchoing(day)).toBe(false);
	});

	it("doesn't judge a short reply", () => {
		expect(
			isEchoing([user("the pipeline broke again"), bot("ugh, again?")]),
		).toBe(false);
	});
});

describe("buildConversationNote", () => {
	it("is empty when the conversation is moving fine", () => {
		const day: Exchange[] = [
			user("morning"),
			bot("morning. the frost got the basil, by the way."),
			user("figures. what do i plant instead?"),
			bot("thyme survives anything. it'll outlive us both."),
		];
		expect(buildConversationNote(day)).toBe("");
	});

	it("tells the companion to drop a topic the owner stopped answering", () => {
		const day: Exchange[] = [
			user("thinking about pottery classes"),
			bot("pottery suits you. what's pulling you toward pottery?"),
			user("dunno. flat viewing tomorrow"),
			bot("pottery would suit you — have you looked at pottery studios?"),
			user("maybe"),
			bot("worth booking a pottery taster session this week."),
		];
		const note = buildConversationNote(day);
		expect(note).toContain("pottery");
		expect(note).toContain("Let it go");
	});

	it("is framed as a note to itself, never as something the owner said", () => {
		const day: Exchange[] = [
			bot("how did that land?"),
			user("fine"),
			bot("and the rest?"),
			user("fine"),
			bot("sure about that?"),
		];
		const note = buildConversationNote(day);
		expect(note).toContain("[how this is going");
		expect(note).toContain("Stop asking");
		expect(note.endsWith("[end]")).toBe(true);
	});
});
