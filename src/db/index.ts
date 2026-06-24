/**
 * Database connection. One SQLite file under DATA_DIR, opened with Bun's native
 * driver and wrapped by Drizzle. Migrations (generated into ./drizzle by
 * `bun run db:generate`) are applied on first open, so a fresh deployment
 * self-initializes. Pass ":memory:" as DATA_DIR for an ephemeral DB (tests).
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { config } from "#/config/index.ts";
import * as schema from "./schema.ts";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type DB = ReturnType<typeof drizzle<typeof schema>>;

function resolveDbPath(dataDir: string): string {
	if (dataDir === ":memory:") return ":memory:";
	mkdirSync(dataDir, { recursive: true });
	return `${dataDir.replace(/\/+$/, "")}/companion.db`;
}

/** Open a database at `path`, apply migrations, and return the Drizzle handle. */
export function createDb(path: string): DB {
	const sqlite = new Database(path);
	sqlite.exec("PRAGMA journal_mode = WAL;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS });
	return db;
}

/** The process-wide database, migrated and ready. */
export const db: DB = createDb(resolveDbPath(config.app.dataDir));
