/**
 * Roll-ups. The nightly pass compresses each day's messages into one durable
 * summary the companion reads on later days, reconciles its long-term memory
 * against the day (save lasting new facts, drop ones the day made wrong), and
 * backfills any earlier day that has messages but no summary yet (e.g. a night
 * the box was off). A weekly pass then steps back over the last week of
 * summaries to consolidate memory — strengthen consistent patterns, merge
 * duplicates, drop one-offs, fix shifts. Memory management lives here, not in the
 * live conversation. Pauses gracefully if the model is unreachable and catches up
 * next run. See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import type { Memory, Message } from "#/db/schema.ts";
import { ProviderUnreachableError } from "#/llm/index.ts";
import { parseActions } from "../actions.ts";
import { markGaps } from "../time.ts";
import { compactPeriods } from "./digest.ts";
import { memoryChat } from "./generate.ts";
import {
	addMemory,
	confirmMemory,
	dayKey,
	distinctMessageDays,
	forgetMemory,
	getDailySummary,
	getSetting,
	lastMessageBefore,
	listDailySummaries,
	listMemories,
	messagesForDay,
	setSetting,
	todayKey,
	upsertDailySummary,
} from "./store.ts";

/**
 * Render a day's messages the way both the summary and extraction prompts read,
 * with the same "[3 hours later]" markers the live conversation shows — so a
 * day that reopened after a long silence is summarized as one.
 */
function transcriptOf(messages: Message[]): string {
	const first = messages[0];
	const marked = markGaps(
		messages,
		first ? lastMessageBefore(first.createdAt) : null,
	);
	return messages
		.map((m, i) => {
			const who = m.role === "user" ? config.app.owner : "You";
			const tag =
				m.kind === "voice" ? " (voice)" : m.kind === "photo" ? " (photo)" : "";
			return `${who}${tag}: ${marked[i] ?? m.content}`;
		})
		.join("\n");
}

function summarySystem(): string {
	const { name, owner } = config.app;
	return `You are ${name}. Compress this one day of conversation with ${owner} into a short, durable summary you will read on later days to remember what happened between you. Remember it the way a close friend would: by its specifics — who, where, what exactly, the numbers and dates, what was decided, what changed — not by its mood. Capture, only where the day actually touched them: what's going on in ${owner}'s life and what moved today; plans with their real dates; decisions; genuinely open threads or promises either of you left hanging; and the small concrete details worth holding. A feeling earns a line only when it was the point of the day. If the day came after a long time apart (a "[… later]" marker), say so in one line. A topic ${owner} simply stopped answering is closed, not open — don't carry it forward as a loose end for you to pick at tomorrow. Write it for yourself, in your own voice. Tight bullets, as few as the day needs. No preamble, no sign-off.`;
}

/** Summarize one day's messages into a compact conclusion. */
export async function summarizeDay(
	day: string,
	messages: Message[],
): Promise<string> {
	return memoryChat(
		[
			{ role: "system", content: summarySystem() },
			{ role: "user", content: `Day ${day}:\n\n${transcriptOf(messages)}` },
		],
		{ think: false, maxTokens: 1024 },
	);
}

// --- memory reconciliation ---------------------------------------------------

/** Don't let one noisy day flood (or gut) memory; the rest waits for next run. */
const MAX_CHANGES_PER_DAY = 12;
/** How many existing memories to scan when deciding what's genuinely new. */
const DEDUP_SCAN = 500;

/** Loose key for de-duplication: case- and whitespace-insensitive. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A saved memory as the roll-up prompts list it: the fact and how fresh it is. */
function memoryLine(m: Memory): string {
	const asOf = dayKey(m.confirmedAt ?? m.createdAt, config.app.timezone);
	return `- ${m.content}  (as of ${asOf})`;
}

export function reconcileSystem(known: Memory[]): string {
	const { name, owner } = config.app;
	const knownList = known.length
		? known.map(memoryLine).join("\n")
		: "(nothing saved yet)";
	return `You are ${name}. Read this one day of conversation with ${owner} and bring your long-term memory up to date. Be a careful editor, not a hoarder: keep a small set of solid, lasting facts — and keep them correct.

Your saved memories right now:
${knownList}

TOP PRIORITY: if ${owner} explicitly asked you to remember, note, or not forget something, SAVE it — that is a direct request and outranks every test below. Capture exactly what they asked you to keep.

Otherwise, what belongs in memory is durable facts that stay true for weeks or months: who ${owner} is and the shape of their life — their work and role, where they live or are from, the people in their life (with names and who they are), lasting habits and routines, settled preferences and tastes, persistent health, ongoing projects, standing commitments, recurring dates, decisions that stick.

What does NOT belong — leave these out (the daily summary already holds them): passing moods and feelings, one-off events ("slept well last night", "had a bad run"), anything tied only to today or "right now", and anything you are merely inferring.

Three jobs:
1. ADD a fact when ${owner} asked you to keep it, or when it is clearly durable, genuinely new, and not already covered above. When in doubt on an unrequested fact, leave it out — a short, true memory set beats a long, noisy one.
2. EDIT what is already there. If the day shows a saved memory is wrong, imprecise, out of date, or too vague — even subtly — drop it, and when there is a better version save the corrected one. Editing means: forget the old wording AND remember the sharper one. Prefer fixing a memory over saving a near-duplicate beside it. A plan or situation that has since resolved (the move happened, the exam is over) is out of date: replace it with how it turned out.
3. CONFIRM what still holds. If the day clearly shows a saved memory is still true — ${owner} said so, or it plainly came up as current — keep it, so its date moves forward. Only for real evidence from the day, not for things that merely weren't contradicted.

Reply using ONLY these tags, each on its own line, and nothing else:
<remember>a fact to keep, one short standalone sentence</remember>
<forget>the exact wording of a saved memory above to drop</forget>
<keep>the exact wording of a saved memory above that the day showed is still true</keep>

Phrase facts plainly and precisely (e.g. "<remember>${owner} works at a school as a software developer</remember>"). Turn any relative dates into real calendar dates using the day's date. Watch for nuance: if ${owner} ran at night once because they had to but normally runs in the morning, do not keep "runs at night" — forget it and save that they usually run in the morning. If there is nothing to add or change, reply with nothing at all.`;
}

export interface MemoryReconcile {
	/** Newly saved facts. */
	saved: string[];
	/** The wording of memories that were dropped. */
	forgotten: string[];
	/** The wording of memories re-confirmed as still true. */
	confirmed: string[];
}

/**
 * Reconcile long-term memory against one day. The model is asked (see
 * `reconcileSystem`) to keep a small, correct set of durable facts: save what's
 * genuinely new and lasting (and anything the owner explicitly asked to keep),
 * and *edit* — drop a saved memory the day made wrong/imprecise and re-add the
 * sharper version. We apply the drops first, then the adds, so a corrected fact
 * isn't blocked as a duplicate of the stale one it replaces. New facts are
 * de-duplicated against what's stored (and each other); drops go through the
 * conservative `forgetMemory` matcher, so a `<forget>` that matches nothing is a
 * no-op. Both directions are capped per run so a degenerate reply can't flood or
 * gut memory. Best-effort: the caller treats a failure as non-fatal.
 */
/**
 * Apply a reconcile reply (`<remember>` / `<forget>` tags) to the store: drop
 * matched memories first, then add the genuinely new ones — de-duplicated
 * against what's stored after the drops, so a corrected fact isn't blocked by
 * the stale one it replaces. `cap` bounds each direction so a degenerate reply
 * can't flood or gut memory. Shared by the daily and weekly passes.
 */
function applyReconcile(
	raw: string,
	cap: number,
	confirmedAt?: Date,
): MemoryReconcile {
	const { remember, forget, keep } = parseActions(raw);

	const forgotten: string[] = [];
	for (const query of forget.slice(0, cap))
		for (const m of forgetMemory(query)) forgotten.push(m.content);

	// Confirmations only move a date forward, so they aren't capped like edits.
	const confirmed: string[] = [];
	if (confirmedAt)
		for (const query of keep)
			for (const m of confirmMemory(query, confirmedAt))
				confirmed.push(m.content);

	const seen = new Set(listMemories(DEDUP_SCAN).map((m) => norm(m.content)));
	const saved: string[] = [];
	for (const fact of remember) {
		const key = norm(fact);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		addMemory(fact);
		saved.push(fact);
		if (saved.length >= cap) break;
	}
	return { saved, forgotten, confirmed };
}

export async function reconcileMemories(
	day: string,
	messages: Message[],
): Promise<MemoryReconcile> {
	const known = listMemories(DEDUP_SCAN);
	const raw = await memoryChat(
		[
			{ role: "system", content: reconcileSystem(known) },
			{ role: "user", content: `Day ${day}:\n\n${transcriptOf(messages)}` },
		],
		{ think: false, maxTokens: 512 },
	);
	// A memory the day re-confirmed is true as of that day, not as of whenever the
	// roll-up happens to run (a backfilled day is often days old).
	return applyReconcile(raw, MAX_CHANGES_PER_DAY, messages.at(-1)?.createdAt);
}

/**
 * Roll up days into durable summaries. With `includeToday` (the nightly run),
 * today is (re)summarized as the day closes; without it (the boot / safety-net
 * backfill) only finished past days are wrapped, so an in-progress day is never
 * summarized prematurely. Either way, every earlier day that has messages but no
 * summary is caught up — e.g. a night the box was off — and the run pauses
 * gracefully if the model is unreachable, catching up next time. When
 * `MEMORY_ROLLUP_EXTRACT` is on, each summarized day also reconciles long-term
 * memory (see `reconcileMemories`). Returns the count of days (re)summarized.
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
			// Reconcile memory against the day. Best-effort and isolated: any trouble
			// here must never undo the summary we just saved or stall the run. The
			// model was just reachable for the summary, so this rarely fails.
			if (config.memory.rollupExtract) {
				try {
					const { saved, forgotten } = await reconcileMemories(day, msgs);
					if (saved.length || forgotten.length)
						console.log(
							`[companion] roll-up reconciled ${day}: ` +
								`+${saved.length} saved, -${forgotten.length} forgotten`,
						);
				} catch (err) {
					console.error(
						`[companion] memory reconcile ${day} failed:`,
						(err as Error).message,
					);
				}
			}
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
	// Then compact any week or month that has finished into its digest. Isolated
	// like the reconcile: it reads summaries already saved and never undoes them.
	try {
		await compactPeriods();
	} catch (err) {
		console.error(
			"[companion] digest compaction failed:",
			(err as Error).message,
		);
	}
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

// --- weekly consolidation ----------------------------------------------------
//
// The daily reconcile is myopic — it sees one day, so it can't tell a one-off
// from a habit or notice what's consistent. A weekly pass steps back over the
// last several days of summaries to keep memory sharp: strengthen patterns that
// recurred, merge near-duplicates, drop one-offs, and fix facts that shifted.

/** Setting key holding the day the weekly consolidation last ran (todayKey). */
const WEEKLY_LAST_RUN = "weekly_consolidation_last_run";
/** How many recent daily summaries the weekly pass reads, and its cadence. */
const WEEKLY_WINDOW_DAYS = 7;
/** Per-run cap on memory changes, like the daily pass but a touch roomier. */
const MAX_CHANGES_PER_WEEK = 20;

function weeklySystem(known: Memory[]): string {
	const { name, owner } = config.app;
	const knownList = known.length
		? known.map(memoryLine).join("\n")
		: "(nothing saved yet)";
	return `You are ${name}. Step back over this past week with ${owner} — you'll see your own daily summaries for it below — and tidy your long-term memory. You are not logging new events here; you are looking across the whole week for what's consistent, and keeping your memory sharp and true. Be conservative: change something only when the week clearly shows a reason.

Your saved memories right now:
${knownList}

Looking across the week as a whole, do any of these — but only with clear support from the summaries:
- STRENGTHEN a pattern: if something recurred across several days, make sure it's saved as a confident, durable fact (e.g. many morning runs → "${owner} usually runs in the morning"). Replace a tentative or vague memory with the sharper version.
- MERGE duplicates: if two saved memories say nearly the same thing, drop the weaker wording and keep one precise version.
- DROP a one-off: if a saved memory turns out to have been a single occasion rather than a real pattern, remove it.
- FIX a shift: if the week shows a fact changed, drop the old wording and save the new.

Leave a memory alone if the week simply didn't bring it up — absence is not a reason to forget. Never drop something ${owner} explicitly asked you to remember.

Reply using ONLY these tags, each on its own line, and nothing else:
<remember>a durable fact to keep or sharpen, one short standalone sentence</remember>
<forget>the exact wording of a saved memory above to drop</forget>
If nothing needs changing, reply with nothing at all.`;
}

/** Whole days from `a` to `b`, both "YYYY-MM-DD" (b − a). */
function daysBetweenKeys(a: string, b: string): number {
	const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
	const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
	const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
	return Math.round(ms / 86_400_000);
}

/** Whether the weekly pass is due: never run, or ≥ a week since it last did. */
export function weeklyDue(): boolean {
	const last = getSetting(WEEKLY_LAST_RUN);
	if (!last) return true;
	return daysBetweenKeys(last, todayKey()) >= WEEKLY_WINDOW_DAYS;
}

/**
 * Consolidate memory against the last week of daily summaries, then record that
 * the pass ran (so the boot/safety catch-up knows it's covered). Returns what
 * changed. A no-op with no summaries yet. Records the run only after a
 * successful model call, so an unreachable model is retried rather than skipped.
 */
export async function weeklyConsolidate(): Promise<MemoryReconcile> {
	const summaries = listDailySummaries(WEEKLY_WINDOW_DAYS).slice().reverse();
	if (!summaries.length) return { saved: [], forgotten: [], confirmed: [] };
	const known = listMemories(DEDUP_SCAN);
	const block = summaries
		.map((s) => `### ${s.day}\n${s.summaryMd}`)
		.join("\n\n");
	const raw = await memoryChat(
		[
			{ role: "system", content: weeklySystem(known) },
			{ role: "user", content: `This past week, day by day:\n\n${block}` },
		],
		{ think: false, maxTokens: 768 },
	);
	const result = applyReconcile(raw, MAX_CHANGES_PER_WEEK);
	setSetting(WEEKLY_LAST_RUN, todayKey());
	return result;
}

/** Gate + run + log the weekly consolidation; swallow a transient model outage. */
async function weeklyRun(): Promise<number> {
	if (!config.memory.rollupExtract || !config.memory.weekly) return 0;
	try {
		const { saved, forgotten } = await weeklyConsolidate();
		if (saved.length || forgotten.length)
			console.log(
				`[companion] weekly consolidation: ` +
					`+${saved.length} saved, -${forgotten.length} forgotten`,
			);
		return saved.length + forgotten.length;
	} catch (err) {
		if (err instanceof ProviderUnreachableError) {
			console.log(
				"[companion] weekly consolidation paused (model unreachable); will retry",
			);
			return 0;
		}
		console.error(
			"[companion] weekly consolidation failed:",
			(err as Error).message,
		);
		return 0;
	}
}

/** The scheduled weekly pass (fires on `MEMORY_WEEKLY_CRON`). */
export function runWeeklyConsolidation(): Promise<number> {
	return weeklyRun();
}

/**
 * Run the weekly pass only if it's overdue — for boot and the periodic safety
 * tick, so a week missed while the box was off/asleep is still caught up the
 * moment it's back. Idempotent: a no-op until a week has elapsed.
 */
export function backfillWeeklyConsolidation(): Promise<number> {
	if (!config.memory.rollupExtract || !config.memory.weekly || !weeklyDue())
		return Promise.resolve(0);
	return weeklyRun();
}
