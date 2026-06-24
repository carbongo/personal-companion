/**
 * Nightly roll-up: compress each day's messages into one durable summary the
 * companion reads on later days, and backfill any earlier day that has messages
 * but no summary yet (e.g. a night the box was off). Pauses gracefully if the
 * model is unreachable and catches up next run. See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import type { Message } from "#/db/schema.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import {
	distinctMessageDays,
	getDailySummary,
	messagesForDay,
	todayKey,
	upsertDailySummary,
} from "./store.ts";

function summarySystem(): string {
	const { name, owner } = config.app;
	return `You are ${name}. Compress this one day of conversation with ${owner} into a short, durable summary you will read on later days to remember what happened between you. Capture, only where the day actually touched them: the state of the two of you and ${owner}'s mood; anything active (projects, work, plans); decisions made; open threads or promises either of you left hanging; and small details worth holding. Write it for yourself, in your own voice, tight and concrete. A few short paragraphs or tight bullets. No preamble, no sign-off.`;
}

/** Summarize one day's messages into a compact conclusion. */
export async function summarizeDay(
	day: string,
	messages: Message[],
): Promise<string> {
	const transcript = messages
		.map((m) => {
			const who = m.role === "user" ? config.app.owner : "You";
			const tag =
				m.kind === "voice" ? " (voice)" : m.kind === "photo" ? " (photo)" : "";
			return `${who}${tag}: ${m.content}`;
		})
		.join("\n");

	return provider.chat(
		[
			{ role: "system", content: summarySystem() },
			{ role: "user", content: `Day ${day}:\n\n${transcript}` },
		],
		{ think: false, maxTokens: 1024 },
	);
}

/**
 * Roll up days into durable summaries. With `includeToday` (the nightly run),
 * today is (re)summarized as the day closes; without it (the boot / safety-net
 * backfill) only finished past days are wrapped, so an in-progress day is never
 * summarized prematurely. Either way, every earlier day that has messages but no
 * summary is caught up — e.g. a night the box was off — and the run pauses
 * gracefully if the model is unreachable, catching up next time. Returns the
 * count of days (re)summarized.
 */
async function rollup(includeToday: boolean): Promise<number> {
	const today = todayKey();
	let done = 0;
	for (const day of distinctMessageDays()) {
		const isToday = day === today;
		if (isToday && !includeToday) continue;
		if (!isToday && getDailySummary(day)) continue;
		const msgs = messagesForDay(day);
		if (!msgs.length) continue;
		try {
			upsertDailySummary(day, await summarizeDay(day, msgs));
			done++;
		} catch (err) {
			if (err instanceof ProviderUnreachableError) {
				console.log(
					"[companion] roll-up paused (model unreachable); will backfill later",
				);
				break;
			}
			console.error(
				`[companion] summarize ${day} failed:`,
				(err as Error).message,
			);
		}
	}
	if (done) console.log(`[companion] roll-up summarized ${done} day(s)`);
	return done;
}

/** The nightly roll-up: wrap today and backfill any missed earlier day. */
export function runDailyRollup(): Promise<number> {
	return rollup(true);
}

/**
 * Wrap any finished past day that has messages but no summary yet — without
 * touching the in-progress day. Run on boot and on a periodic safety tick so
 * "yesterday" still gets summarized after the box was asleep through its nightly
 * time, the moment it's back up. Idempotent: a no-op when nothing is pending.
 */
export function backfillPastDays(): Promise<number> {
	return rollup(false);
}
