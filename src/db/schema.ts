/**
 * Database schema (SQLite via Drizzle). Single-user: exactly one companion per
 * deployment, so no owner/tenant columns. Table names are generic — nothing here
 * is tied to a particular persona. See docs/data-model.md.
 */
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`);

/** Rolling conversation log, bucketed by local day (`day` = YYYY-MM-DD in TZ). */
export const messages = sqliteTable(
	"messages",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		day: text("day").notNull(),
		role: text("role", { enum: ["user", "assistant"] }).notNull(),
		kind: text("kind", { enum: ["text", "voice", "photo"] })
			.notNull()
			.default("text"),
		content: text("content").notNull(),
		mediaUrl: text("media_url"),
		createdAt: createdAt(),
	},
	(t) => [
		index("messages_day_idx").on(t.day),
		index("messages_created_idx").on(t.createdAt),
	],
);

/** The living "Core" memory doc — a singleton (id = 1). */
export const core = sqliteTable("core", {
	id: integer("id").primaryKey(),
	contentMd: text("content_md").notNull().default(""),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

/** Discrete facts the companion saves on its own (or you add). */
export const memories = sqliteTable(
	"memories",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		content: text("content").notNull(),
		tags: text("tags"),
		createdAt: createdAt(),
		/**
		 * When a later conversation last showed this was still true (null = never
		 * re-confirmed since it was saved). How fresh a fact is tells the companion
		 * how far to trust it after time apart.
		 */
		confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("memories_created_idx").on(t.createdAt)],
);

/** One compressed summary per past day, produced by the nightly roll-up. */
export const dailySummaries = sqliteTable("daily_summaries", {
	day: text("day").primaryKey(),
	summaryMd: text("summary_md").notNull(),
	createdAt: createdAt(),
});

/**
 * Coarser compactions of the daily summaries: one per finished week (Monday to
 * Sunday) and one per finished month. Older stretches of time ride in context as
 * these instead of as days, so the horizon grows while the prompt stays small.
 */
export const digests = sqliteTable(
	"digests",
	{
		kind: text("kind", { enum: ["week", "month"] }).notNull(),
		/** First day covered, YYYY-MM-DD. */
		start: text("start").notNull(),
		/** Last day covered, YYYY-MM-DD. */
		end: text("end").notNull(),
		summaryMd: text("summary_md").notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.kind, t.start] })],
);

/** Key/value config edited in the web UI (e.g. a persona override). */
export const settings = sqliteTable("settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type DailySummary = typeof dailySummaries.$inferSelect;
export type Digest = typeof digests.$inferSelect;
