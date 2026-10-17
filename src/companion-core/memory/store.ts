/**
 * Persistence for the companion's memory: the daily message log, the Core doc,
 * discrete memories, daily summaries, and a small settings key/value store. All
 * reads/writes go through here. See docs/memory.md.
 */
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";

import { config } from "#/config/index.ts";
import { db } from "#/db/index.ts";
import {
	core,
	type DailySummary,
	type Digest,
	dailySummaries,
	digests,
	type Memory,
	type Message,
	memories,
	messages,
	settings,
} from "#/db/schema.ts";

// --- local-day bucketing -----------------------------------------------------

/** "YYYY-MM-DD" for `d` in the given IANA timezone (en-CA renders ISO order). */
export function dayKey(d: Date, tz: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);
}

/** Today's local day key, using the configured timezone. */
export function todayKey(): string {
	return dayKey(new Date(), config.app.timezone);
}

// --- conversation log --------------------------------------------------------

export interface NewMessage {
	day: string;
	role: "user" | "assistant";
	kind?: "text" | "voice" | "photo";
	content: string;
	mediaUrl?: string | null;
}

export function appendMessage(m: NewMessage): Message {
	return db
		.insert(messages)
		.values({
			day: m.day,
			role: m.role,
			kind: m.kind ?? "text",
			content: m.content,
			mediaUrl: m.mediaUrl ?? null,
		})
		.returning()
		.get();
}

/**
 * Attach saved media to an already-logged message. A spoken reply is streamed
 * and synthesized paragraph by paragraph, so its audio only exists once the
 * reply is over — the row is written first, then pointed at the clips.
 */
export function setMessageMedia(
	id: number,
	kind: "text" | "voice" | "photo",
	mediaUrl: string | null,
): void {
	db.update(messages).set({ kind, mediaUrl }).where(eq(messages.id, id)).run();
}

/**
 * Rewrite an already-logged message's text. A live call can be cut off
 * mid-reply, and the log has to end up saying what the owner actually heard: if
 * the companion believes it said something that was never spoken aloud, every
 * later turn reasons from words that do not exist.
 */
export function setMessageContent(id: number, content: string): void {
	db.update(messages).set({ content }).where(eq(messages.id, id)).run();
}

/**
 * Drop a logged message. Used when a reply was interrupted before a single word
 * of it was heard — for the same reason a blank draw is never stored, an
 * assistant turn nobody received would only be mimicked on the next one.
 */
export function deleteMessage(id: number): void {
	db.delete(messages).where(eq(messages.id, id)).run();
}

export function messagesForDay(day: string): Message[] {
	return db
		.select()
		.from(messages)
		.where(eq(messages.day, day))
		.orderBy(asc(messages.createdAt), asc(messages.id))
		.all();
}

/** The newest messages across all days, newest first. */
export function latestMessages(limit: number): Message[] {
	return db
		.select()
		.from(messages)
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(limit)
		.all();
}

/** The last message logged strictly before `at`, if any. */
export function lastMessageBefore(at: Date): Message | null {
	return (
		db
			.select()
			.from(messages)
			.where(lt(messages.createdAt, at))
			.orderBy(desc(messages.createdAt), desc(messages.id))
			.limit(1)
			.get() ?? null
	);
}

/** Distinct days that have messages, oldest first. */
export function distinctMessageDays(): string[] {
	return db
		.selectDistinct({ day: messages.day })
		.from(messages)
		.orderBy(asc(messages.day))
		.all()
		.map((r) => r.day);
}

// --- core doc ----------------------------------------------------------------

export function getCore(): string {
	const row = db.select().from(core).where(eq(core.id, 1)).get();
	if (row) return row.contentMd;
	db.insert(core).values({ id: 1, contentMd: "" }).onConflictDoNothing().run();
	return "";
}

export function setCore(contentMd: string): void {
	getCore(); // ensure the singleton row exists
	db.update(core)
		.set({ contentMd, updatedAt: new Date() })
		.where(eq(core.id, 1))
		.run();
}

// --- discrete memories -------------------------------------------------------

export function addMemory(content: string, tags?: string | null): Memory {
	return db
		.insert(memories)
		.values({ content, tags: tags ?? null })
		.returning()
		.get();
}

export function deleteMemory(id: number): void {
	db.delete(memories).where(eq(memories.id, id)).run();
}

const wordsOf = (s: string): Set<string> =>
	new Set(
		s
			.toLowerCase()
			.split(/\W+/)
			.filter((w) => w.length > 2),
	);

/**
 * The memories `query` refers to. Conservative on purpose, so acting on "forget
 * that" never touches the wrong thing: an exact (case-insensitive) match wins
 * and returns all such rows; otherwise the single closest memory — one that
 * contains (or is contained by) the query, or, failing that, one with strong
 * word overlap (≥60%). Returns [] when nothing matches closely enough.
 */
function matchMemories(query: string): Memory[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const all = listMemories(500);

	const exact = all.filter((m) => m.content.trim().toLowerCase() === q);
	if (exact.length) return exact;

	const subs = all
		.filter((m) => {
			const c = m.content.toLowerCase();
			return c.includes(q) || q.includes(c);
		})
		.sort(
			(a, b) =>
				Math.abs(a.content.length - query.length) -
				Math.abs(b.content.length - query.length),
		);
	if (subs[0]) return [subs[0]];

	const qWords = wordsOf(q);
	if (qWords.size) {
		let best: Memory | null = null;
		let bestScore = 0;
		for (const m of all) {
			const words = wordsOf(m.content);
			let overlap = 0;
			for (const w of qWords) if (words.has(w)) overlap++;
			const score = overlap / qWords.size;
			if (score > bestScore) {
				bestScore = score;
				best = m;
			}
		}
		if (best && bestScore >= 0.6) return [best];
	}
	return [];
}

/** Forget the memories `query` refers to (see `matchMemories`), returning them. */
export function forgetMemory(query: string): Memory[] {
	const found = matchMemories(query);
	for (const m of found) deleteMemory(m.id);
	return found;
}

/**
 * Mark the memories `query` refers to as still true as of `at`. A fact the owner
 * re-confirmed after time apart is worth trusting again; one nobody has touched
 * in months is worth checking.
 */
export function confirmMemory(query: string, at: Date = new Date()): Memory[] {
	const found = matchMemories(query);
	for (const m of found)
		db.update(memories)
			.set({ confirmedAt: at })
			.where(eq(memories.id, m.id))
			.run();
	return found;
}

export function listMemories(limit = 200): Memory[] {
	return db
		.select()
		.from(memories)
		.orderBy(desc(memories.createdAt))
		.limit(limit)
		.all();
}

export function searchMemories(query: string, limit = 20): Memory[] {
	const q = query.trim();
	if (!q) return listMemories(limit);
	const like = `%${q.toLowerCase()}%`;
	return db
		.select()
		.from(memories)
		.where(
			sql`lower(${memories.content}) like ${like} or lower(coalesce(${memories.tags}, '')) like ${like}`,
		)
		.orderBy(desc(memories.createdAt))
		.limit(limit)
		.all();
}

// --- daily summaries ---------------------------------------------------------

export function getDailySummary(day: string): DailySummary | null {
	return (
		db.select().from(dailySummaries).where(eq(dailySummaries.day, day)).get() ??
		null
	);
}

export function upsertDailySummary(day: string, summaryMd: string): void {
	db.insert(dailySummaries)
		.values({ day, summaryMd })
		.onConflictDoUpdate({
			target: dailySummaries.day,
			set: { summaryMd, createdAt: new Date() },
		})
		.run();
}

export function listDailySummaries(limit = 60): DailySummary[] {
	return db
		.select()
		.from(dailySummaries)
		.orderBy(desc(dailySummaries.day))
		.limit(limit)
		.all();
}

/** Recent daily summaries for days strictly before `before`, oldest first. */
export function recentSummariesBefore(
	before: string,
	limit: number,
): DailySummary[] {
	return db
		.select()
		.from(dailySummaries)
		.where(lt(dailySummaries.day, before))
		.orderBy(desc(dailySummaries.day))
		.limit(limit)
		.all()
		.reverse();
}

/** Daily summaries for days in [start, end], oldest first. */
export function summariesBetween(start: string, end: string): DailySummary[] {
	return db
		.select()
		.from(dailySummaries)
		.where(and(gte(dailySummaries.day, start), lte(dailySummaries.day, end)))
		.orderBy(asc(dailySummaries.day))
		.all();
}

// --- week / month digests ----------------------------------------------------

export function getDigest(kind: Digest["kind"], start: string): Digest | null {
	return (
		db
			.select()
			.from(digests)
			.where(and(eq(digests.kind, kind), eq(digests.start, start)))
			.get() ?? null
	);
}

export function upsertDigest(
	kind: Digest["kind"],
	start: string,
	end: string,
	summaryMd: string,
): void {
	db.insert(digests)
		.values({ kind, start, end, summaryMd })
		.onConflictDoUpdate({
			target: [digests.kind, digests.start],
			set: { end, summaryMd, createdAt: new Date() },
		})
		.run();
}

/** Drop a digest; the next roll-up run writes it afresh from its days. */
export function deleteDigest(kind: Digest["kind"], start: string): void {
	db.delete(digests)
		.where(and(eq(digests.kind, kind), eq(digests.start, start)))
		.run();
}

/** Every digest of a kind, newest first (a few dozen a year at most). */
export function listDigests(kind: Digest["kind"]): Digest[] {
	return db
		.select()
		.from(digests)
		.where(eq(digests.kind, kind))
		.orderBy(desc(digests.start))
		.all();
}

// --- settings (key/value) ----------------------------------------------------

export function getSetting(key: string): string | null {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
	db.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, updatedAt: new Date() },
		})
		.run();
}
