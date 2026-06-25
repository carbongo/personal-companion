/**
 * Database schema (SQLite via Drizzle). Single-user: exactly one companion per
 * deployment, so no owner/tenant columns. Table names are generic — nothing here
 * is tied to a particular persona. See docs/data-model.md.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
	},
	(t) => [index("memories_created_idx").on(t.createdAt)],
);

/** One compressed summary per past day, produced by the nightly roll-up. */
export const dailySummaries = sqliteTable("daily_summaries", {
	day: text("day").primaryKey(),
	summaryMd: text("summary_md").notNull(),
	createdAt: createdAt(),
});

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
