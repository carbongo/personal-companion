/**
 * Persistence for the companion's memory: the daily message log, the Core doc,
 * discrete memories, daily summaries, the companion's own notes, and a small
 * settings key/value store. All reads/writes go through here. See docs/memory.md.
 */
import { asc, desc, eq, lt, sql } from "drizzle-orm";

import { config } from "#/config/index.ts";
import { db } from "#/db/index.ts";
import {
	core,
	type DailySummary,
	dailySummaries,
	type Memory,
	type Message,
	memories,
	messages,
	notes,
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

export function messagesForDay(day: string): Message[] {
	return db
		.select()
		.from(messages)
		.where(eq(messages.day, day))
		.orderBy(asc(messages.createdAt), asc(messages.id))
		.all();
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

// --- notes -------------------------------------------------------------------

export function createNote(title: string, contentMd = ""): void {
	db.insert(notes).values({ title, contentMd }).run();
}

export function listNoteTitles(limit = 50): string[] {
	return db
		.select({ title: notes.title })
		.from(notes)
		.orderBy(desc(notes.createdAt))
		.limit(limit)
		.all()
		.map((r) => r.title);
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
