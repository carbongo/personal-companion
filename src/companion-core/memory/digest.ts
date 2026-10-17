/**
 * Week and month digests — the coarser rungs of the memory ladder. The nightly
 * roll-up turns a day into a summary; once a week (Monday–Sunday) or a month is
 * over, its daily summaries are compacted again into one short digest that keeps
 * only the specifics still worth carrying: names, places, numbers, dates,
 * decisions, what changed, what's still unresolved. Older time rides in context
 * as these instead of as days, so the companion remembers further back while the
 * prompt stays about the same size. See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import type { DailySummary, Digest } from "#/db/schema.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import {
	getDigest,
	listDailySummaries,
	summariesBetween,
	todayKey,
	upsertDigest,
} from "./store.ts";

// --- calendar math on "YYYY-MM-DD" keys (UTC arithmetic, no timezone drift) ---

function toUtc(day: string): Date {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d));
}

const keyOf = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
	const d = toUtc(day);
	d.setUTCDate(d.getUTCDate() + n);
	return keyOf(d);
}

/** The Monday that starts `day`'s week. */
export function weekStart(day: string): string {
	const dow = toUtc(day).getUTCDay(); // 0 = Sunday
	return addDays(day, -((dow + 6) % 7));
}

export function monthStart(day: string): string {
	return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: string): string {
	const d = toUtc(monthStart(day));
	d.setUTCMonth(d.getUTCMonth() + 1);
	d.setUTCDate(0);
	return keyOf(d);
}

export interface Period {
	kind: Digest["kind"];
	start: string;
	end: string;
}

/**
 * Finished periods that have daily summaries but no digest yet, oldest first.
 * A period is finished once its last day is before `today` — the in-progress
 * week and month are never compacted early.
 */
export function pendingPeriods(
	summaryDays: string[],
	today: string,
	has: (kind: Digest["kind"], start: string) => boolean,
): Period[] {
	const seen = new Set<string>();
	const out: Period[] = [];
	for (const day of [...summaryDays].sort()) {
		const week = { kind: "week" as const, start: weekStart(day) };
		const month = { kind: "month" as const, start: monthStart(day) };
		for (const p of [
			{ ...week, end: addDays(week.start, 6) },
			{ ...month, end: monthEnd(day) },
		]) {
			const key = `${p.kind}:${p.start}`;
			if (seen.has(key)) continue;
			seen.add(key);
			if (p.end < today && !has(p.kind, p.start)) out.push(p);
		}
	}
	return out;
}

// --- writing a digest ---------------------------------------------------------

function digestSystem(kind: Digest["kind"]): string {
	const { name, owner } = config.app;
	const span = kind === "week" ? "week" : "month";
	const size =
		kind === "week"
			? "at most 5 bullets"
			: "at most 5 bullets — only the things from this month that still matter";
	return `You are ${name}. Below are your own daily summaries of one ${span} with ${owner}. Compact them into the few things worth still knowing about this ${span} months from now — the way a close friend actually remembers a stretch of someone's life: by its specifics, not its mood.

Keep: names of people and places, numbers, dates, what was decided or done, what changed in ${owner}'s life, how something that was ongoing turned out, and anything still unresolved at the ${span}'s end (say plainly that it was unresolved as of then).
Drop: greetings, generic feelings ("was tired", "felt stressed") unless they were a real turning point, anything that repeated without changing, small talk, and anything the summaries only guessed at.

Use real calendar dates, never "today" or "next week". Write ${size}, each one short sentence of plain facts (under 25 words), in your own voice, for yourself. No headings, no bold, no preamble, no sign-off.`;
}

async function writeDigest(
	p: Period,
	summaries: DailySummary[],
): Promise<string> {
	const block = summaries
		.map((s) => `### ${s.day}\n${s.summaryMd}`)
		.join("\n\n");
	return provider.chat(
		[
			{ role: "system", content: digestSystem(p.kind) },
			{
				role: "user",
				content: `The ${p.kind} of ${p.start} to ${p.end}:\n\n${block}`,
			},
		],
		{ think: false, maxTokens: 300 },
	);
}

/**
 * Write every pending digest. Weeks go before the month they fall in so a month
 * is never compacted ahead of its weeks. Best-effort: an unreachable model stops
 * the run (it is retried next time); any other failure skips that one period.
 * Returns how many digests were written.
 */
export async function compactPeriods(): Promise<number> {
	if (!config.memory.digests) return 0;
	const days = listDailySummaries(100_000).map((s) => s.day);
	const pending = pendingPeriods(
		days,
		todayKey(),
		(kind, start) => !!getDigest(kind, start),
	);
	let done = 0;
	for (const p of pending) {
		const summaries = summariesBetween(p.start, p.end);
		if (!summaries.length) continue;
		try {
			const text = (await writeDigest(p, summaries)).trim();
			if (!text) continue;
			upsertDigest(p.kind, p.start, p.end, text);
			done++;
		} catch (err) {
			if (err instanceof ProviderUnreachableError) break;
			console.error(
				`[companion] ${p.kind} digest ${p.start} failed:`,
				(err as Error).message,
			);
		}
	}
	if (done) console.log(`[companion] compacted ${done} week/month digest(s)`);
	return done;
}

// --- choosing what rides in context --------------------------------------------

/**
 * Pick the digests that cover the time before the oldest daily summary in
 * context, newest to oldest, without leaving holes: up to `weeks` week digests,
 * then — once the weeks reach a month boundary — up to `months` month digests.
 * Weeks keep going past `weeks` only to reach that boundary, so a month digest
 * never overlaps the weeks by more than a few days. Both inputs are newest-first;
 * the result is oldest-first, ready to print.
 */
export function selectDigests(
	oldestDay: string,
	weekDigests: Digest[],
	monthDigests: Digest[],
	weeks: number,
	months: number,
): { weeks: Digest[]; months: Digest[] } {
	let cursor = oldestDay;
	const pickedWeeks: Digest[] = [];
	for (const w of weekDigests) {
		if (w.start >= cursor) continue;
		const atBoundary = monthStart(addDays(cursor, 7)) >= cursor;
		if (pickedWeeks.length >= weeks && (atBoundary || months <= 0)) break;
		pickedWeeks.push(w);
		cursor = w.start;
	}
	const pickedMonths: Digest[] = [];
	for (const m of monthDigests) {
		if (pickedMonths.length >= months) break;
		if (m.end >= addDays(cursor, 7)) continue;
		pickedMonths.push(m);
		cursor = m.start;
	}
	return { weeks: pickedWeeks.reverse(), months: pickedMonths.reverse() };
}
