/**
 * Nightly roll-up: compress each day's messages into one durable summary the
 * companion reads on later days, reconcile its long-term memory against the day
 * (save lasting new facts, drop ones the day made wrong), and backfill any
 * earlier day that has messages but no summary yet (e.g. a night the box was
 * off). Memory management lives here, not in the live conversation. Pauses
 * gracefully if the model is unreachable and catches up next run. See
 * docs/memory.md.
 */
import { config } from "#/config/index.ts";
import type { Memory, Message } from "#/db/schema.ts";
import { ProviderUnreachableError, provider } from "#/llm/index.ts";
import { parseActions } from "../actions.ts";
import {
	addMemory,
	distinctMessageDays,
	forgetMemory,
	getDailySummary,
	listMemories,
	messagesForDay,
	todayKey,
	upsertDailySummary,
} from "./store.ts";

/** Render a day's messages the way both the summary and extraction prompts read. */
function transcriptOf(messages: Message[]): string {
	return messages
		.map((m) => {
			const who = m.role === "user" ? config.app.owner : "You";
			const tag =
				m.kind === "voice" ? " (voice)" : m.kind === "photo" ? " (photo)" : "";
			return `${who}${tag}: ${m.content}`;
		})
		.join("\n");
}

function summarySystem(): string {
	const { name, owner } = config.app;
	return `You are ${name}. Compress this one day of conversation with ${owner} into a short, durable summary you will read on later days to remember what happened between you. Capture, only where the day actually touched them: the state of the two of you and ${owner}'s mood; anything active (projects, work, plans); decisions made; open threads or promises either of you left hanging; and small details worth holding. Write it for yourself, in your own voice, tight and concrete. A few short paragraphs or tight bullets. No preamble, no sign-off.`;
}

/** Summarize one day's messages into a compact conclusion. */
export async function summarizeDay(
	day: string,
	messages: Message[],
): Promise<string> {
	return provider.chat(
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

export function reconcileSystem(known: Memory[]): string {
	const { name, owner } = config.app;
	const knownList = known.length
		? known.map((m) => `- ${m.content}`).join("\n")
		: "(nothing saved yet)";
	return `You are ${name}. Read this one day of conversation with ${owner} and bring your long-term memory up to date. Be a careful editor, not a hoarder: keep a small set of solid, lasting facts — and keep them correct.

Your saved memories right now:
${knownList}

TOP PRIORITY: if ${owner} explicitly asked you to remember, note, or not forget something, SAVE it — that is a direct request and outranks every test below. Capture exactly what they asked you to keep.

Otherwise, what belongs in memory is durable facts that stay true for weeks or months: who ${owner} is and the shape of their life — their work and role, where they live or are from, the people in their life (with names and who they are), lasting habits and routines, settled preferences and tastes, persistent health, ongoing projects, standing commitments, recurring dates, decisions that stick.

What does NOT belong — leave these out (the daily summary already holds them): passing moods and feelings, one-off events ("slept well last night", "had a bad run"), anything tied only to today or "right now", and anything you are merely inferring.

Two jobs:
1. ADD a fact when ${owner} asked you to keep it, or when it is clearly durable, genuinely new, and not already covered above. When in doubt on an unrequested fact, leave it out — a short, true memory set beats a long, noisy one.
2. EDIT what is already there. If the day shows a saved memory is wrong, imprecise, out of date, or too vague — even subtly — drop it, and when there is a better version save the corrected one. Editing means: forget the old wording AND remember the sharper one. Prefer fixing a memory over saving a near-duplicate beside it.

Reply using ONLY these tags, each on its own line, and nothing else:
<remember>a fact to keep, one short standalone sentence</remember>
<forget>the exact wording of a saved memory above to drop</forget>

Phrase facts plainly and precisely (e.g. "<remember>${owner} works at a school as a software developer</remember>"). Turn any relative dates into real calendar dates using the day's date. Watch for nuance: if ${owner} ran at night once because they had to but normally runs in the morning, do not keep "runs at night" — forget it and save that they usually run in the morning. If there is nothing to add or change, reply with nothing at all.`;
}

export interface MemoryReconcile {
	/** Newly saved facts. */
	saved: string[];
	/** The wording of memories that were dropped. */
	forgotten: string[];
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
export async function reconcileMemories(
	day: string,
	messages: Message[],
): Promise<MemoryReconcile> {
	const known = listMemories(DEDUP_SCAN);
	const raw = await provider.chat(
		[
			{ role: "system", content: reconcileSystem(known) },
			{ role: "user", content: `Day ${day}:\n\n${transcriptOf(messages)}` },
		],
		{ think: false, maxTokens: 512 },
	);
	const { remember, forget } = parseActions(raw);

	const forgotten: string[] = [];
	for (const query of forget.slice(0, MAX_CHANGES_PER_DAY))
		for (const m of forgetMemory(query)) forgotten.push(m.content);

	// Re-scan: a fact we just dropped shouldn't block re-saving a corrected form.
	const seen = new Set(listMemories(DEDUP_SCAN).map((m) => norm(m.content)));
	const saved: string[] = [];
	for (const fact of remember) {
		const key = norm(fact);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		addMemory(fact);
		saved.push(fact);
		if (saved.length >= MAX_CHANGES_PER_DAY) break;
	}
	return { saved, forgotten };
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
