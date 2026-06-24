#!/usr/bin/env bun

// One-off importer: brings an existing companion's history into this schema
// from a neutral, documented interchange format — a directory of files you (or
// a tiny adapter) produce from your old system. It is deliberately decoupled
// from any source: the project ships only this generic importer and the format
// spec, never anyone's source schema. The personal data you import stays in
// your local DATA_DIR database and is never committed. See docs/importing.md
// and AGENTS.md.
//
// The interchange directory (default ./import) may hold any subset of:
//   core.md              — the Core doc (plain Markdown/text)
//   messages.jsonl       — one JSON object per line:
//                          { role, content, day?, kind?, mediaUrl?, createdAt? }
//   memories.json        — array of { content, tags?, createdAt? }
//   daily-summaries.json — array of { day, summary, createdAt? }
//   notes.json           — array of { title, content?, createdAt? }
//
// Usage:  bun run import [dir] [--dry-run] [--force] [--strict]

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { eq, sql } from "drizzle-orm";

import { dayKey } from "#/companion-core/memory/store.ts";
import { config } from "#/config/index.ts";
import type { DB } from "#/db/index.ts";
import {
	core,
	dailySummaries,
	memories,
	messages,
	notes,
} from "#/db/schema.ts";

// --- parsed record shapes -----------------------------------------------------

export interface MsgRecord {
	day: string;
	role: "user" | "assistant";
	kind: "text" | "voice" | "photo";
	content: string;
	mediaUrl: string | null;
	createdAt?: Date;
}

export interface MemoryRecord {
	content: string;
	tags: string | null;
	createdAt?: Date;
}

export interface SummaryRecord {
	day: string;
	summaryMd: string;
	createdAt?: Date;
}

export interface NoteRecord {
	title: string;
	contentMd: string;
	createdAt?: Date;
}

export interface ImportData {
	core?: string;
	messages: MsgRecord[];
	memories: MemoryRecord[];
	summaries: SummaryRecord[];
	notes: NoteRecord[];
}

export interface LoadResult {
	data: ImportData;
	errors: string[];
}

// --- small validation helpers -------------------------------------------------

const ROLES = new Set(["user", "assistant"]);
const KINDS = new Set(["text", "voice", "photo"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Accept an ISO-8601 string or epoch-millis (number, or all-digit string). */
export function parseTimestamp(v: unknown): Date | undefined {
	if (typeof v === "number") {
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? undefined : d;
	}
	if (typeof v === "string") {
		const t = v.trim();
		if (!t) return undefined;
		const d = /^\d+$/.test(t) ? new Date(Number(t)) : new Date(t);
		return Number.isNaN(d.getTime()) ? undefined : d;
	}
	return undefined;
}

function nonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0;
}

// --- per-table parsers --------------------------------------------------------
// Each returns valid records plus a list of human-readable errors. A bad record
// is reported and skipped; the caller decides whether to abort (--strict).

function parseMessages(
	text: string,
	tz: string,
): { records: MsgRecord[]; errors: string[] } {
	const records: MsgRecord[] = [];
	const errors: string[] = [];
	for (const [i, rawLine] of text.split("\n").entries()) {
		const line = rawLine.trim();
		if (!line) continue;
		const at = `messages.jsonl:${i + 1}`;
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			errors.push(`${at}: not valid JSON`);
			continue;
		}
		if (!isObject(obj)) {
			errors.push(`${at}: not an object`);
			continue;
		}
		if (!ROLES.has(obj.role as string)) {
			errors.push(`${at}: role must be "user" or "assistant"`);
			continue;
		}
		if (!nonEmptyString(obj.content)) {
			errors.push(`${at}: content is required`);
			continue;
		}
		const kind = obj.kind === undefined ? "text" : (obj.kind as string);
		if (!KINDS.has(kind)) {
			errors.push(`${at}: kind must be text|voice|photo`);
			continue;
		}
		let createdAt: Date | undefined;
		if ("createdAt" in obj) {
			createdAt = parseTimestamp(obj.createdAt);
			if (!createdAt) {
				errors.push(`${at}: createdAt is not a valid timestamp`);
				continue;
			}
		}
		let day = obj.day as string | undefined;
		if (day !== undefined && !DAY_RE.test(day)) {
			errors.push(`${at}: day must be YYYY-MM-DD`);
			continue;
		}
		if (!day) {
			if (!createdAt) {
				errors.push(`${at}: needs a "day" or a "createdAt" to bucket by`);
				continue;
			}
			day = dayKey(createdAt, tz);
		}
		records.push({
			day,
			role: obj.role as "user" | "assistant",
			kind: kind as "text" | "voice" | "photo",
			content: obj.content as string,
			mediaUrl: nonEmptyString(obj.mediaUrl) ? obj.mediaUrl : null,
			createdAt,
		});
	}
	return { records, errors };
}

function parseJsonArray(
	text: string,
	file: string,
): { items: Record<string, unknown>[]; errors: string[] } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { items: [], errors: [`${file}: not valid JSON`] };
	}
	if (!Array.isArray(parsed)) {
		return { items: [], errors: [`${file}: expected a JSON array`] };
	}
	const items: Record<string, unknown>[] = [];
	const errors: string[] = [];
	for (const [i, item] of parsed.entries()) {
		if (isObject(item)) items.push(item);
		else errors.push(`${file}[${i}]: not an object`);
	}
	return { items, errors };
}

function parseMemories(text: string): {
	records: MemoryRecord[];
	errors: string[];
} {
	const { items, errors } = parseJsonArray(text, "memories.json");
	const records: MemoryRecord[] = [];
	for (const [i, o] of items.entries()) {
		const at = `memories.json[${i}]`;
		if (!nonEmptyString(o.content)) {
			errors.push(`${at}: content is required`);
			continue;
		}
		const createdAt =
			"createdAt" in o ? parseTimestamp(o.createdAt) : undefined;
		if ("createdAt" in o && !createdAt) {
			errors.push(`${at}: createdAt is not a valid timestamp`);
			continue;
		}
		records.push({
			content: o.content,
			tags: nonEmptyString(o.tags) ? o.tags : null,
			createdAt,
		});
	}
	return { records, errors };
}

function parseSummaries(text: string): {
	records: SummaryRecord[];
	errors: string[];
} {
	const { items, errors } = parseJsonArray(text, "daily-summaries.json");
	const records: SummaryRecord[] = [];
	for (const [i, o] of items.entries()) {
		const at = `daily-summaries.json[${i}]`;
		const summary = (o.summary ?? o.summaryMd) as unknown;
		if (typeof o.day !== "string" || !DAY_RE.test(o.day)) {
			errors.push(`${at}: day must be YYYY-MM-DD`);
			continue;
		}
		if (!nonEmptyString(summary)) {
			errors.push(`${at}: summary is required`);
			continue;
		}
		const createdAt =
			"createdAt" in o ? parseTimestamp(o.createdAt) : undefined;
		if ("createdAt" in o && !createdAt) {
			errors.push(`${at}: createdAt is not a valid timestamp`);
			continue;
		}
		records.push({ day: o.day, summaryMd: summary, createdAt });
	}
	return { records, errors };
}

function parseNotes(text: string): { records: NoteRecord[]; errors: string[] } {
	const { items, errors } = parseJsonArray(text, "notes.json");
	const records: NoteRecord[] = [];
	for (const [i, o] of items.entries()) {
		const at = `notes.json[${i}]`;
		if (!nonEmptyString(o.title)) {
			errors.push(`${at}: title is required`);
			continue;
		}
		const createdAt =
			"createdAt" in o ? parseTimestamp(o.createdAt) : undefined;
		if ("createdAt" in o && !createdAt) {
			errors.push(`${at}: createdAt is not a valid timestamp`);
			continue;
		}
		records.push({
			title: o.title,
			contentMd: typeof o.content === "string" ? o.content : "",
			createdAt,
		});
	}
	return { records, errors };
}

// --- load a directory ---------------------------------------------------------

/** Read and validate every recognized file present in `dir`. */
export function loadImportDir(dir: string, tz: string): LoadResult {
	const data: ImportData = {
		messages: [],
		memories: [],
		summaries: [],
		notes: [],
	};
	const errors: string[] = [];

	const corePath = join(dir, "core.md");
	if (existsSync(corePath)) data.core = readFileSync(corePath, "utf8");

	const msgPath = join(dir, "messages.jsonl");
	if (existsSync(msgPath)) {
		const r = parseMessages(readFileSync(msgPath, "utf8"), tz);
		data.messages = r.records;
		errors.push(...r.errors);
	}

	const memPath = join(dir, "memories.json");
	if (existsSync(memPath)) {
		const r = parseMemories(readFileSync(memPath, "utf8"));
		data.memories = r.records;
		errors.push(...r.errors);
	}

	const sumPath = join(dir, "daily-summaries.json");
	if (existsSync(sumPath)) {
		const r = parseSummaries(readFileSync(sumPath, "utf8"));
		data.summaries = r.records;
		errors.push(...r.errors);
	}

	const notePath = join(dir, "notes.json");
	if (existsSync(notePath)) {
		const r = parseNotes(readFileSync(notePath, "utf8"));
		data.notes = r.records;
		errors.push(...r.errors);
	}

	return { data, errors };
}

// --- writing ------------------------------------------------------------------

export interface ImportSummary {
	core: "set" | "skipped" | "none";
	messages: number;
	memories: number;
	summaries: number;
	notes: number;
}

function rowCount(
	db: DB,
	table: typeof messages | typeof memories | typeof notes,
) {
	return db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
	for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

/**
 * Apply parsed `data` to `db` in a single transaction. Refuses to touch tables
 * that already hold rows unless `force` is set, so a re-run can't silently
 * duplicate a history (messages/memories/notes have no natural key). Daily
 * summaries upsert by day, and the Core doc is only overwritten with `force`.
 */
export function importAll(
	db: DB,
	data: ImportData,
	opts: { force?: boolean } = {},
): ImportSummary {
	const force = opts.force ?? false;

	if (!force) {
		const clashes: string[] = [];
		if (data.messages.length && rowCount(db, messages))
			clashes.push("messages");
		if (data.memories.length && rowCount(db, memories))
			clashes.push("memories");
		if (data.notes.length && rowCount(db, notes)) clashes.push("notes");
		if (clashes.length) {
			throw new Error(
				`target database already has ${clashes.join(", ")}; ` +
					"re-run with --force to import anyway, or point DATA_DIR at a " +
					"fresh database",
			);
		}
	}

	const existingCore =
		db.select({ c: core.contentMd }).from(core).where(eq(core.id, 1)).get()
			?.c ?? "";

	const summary: ImportSummary = {
		core: "none",
		messages: 0,
		memories: 0,
		summaries: 0,
		notes: 0,
	};

	db.transaction((tx) => {
		if (data.core !== undefined) {
			if (existingCore.trim() && !force) {
				summary.core = "skipped";
			} else {
				tx.insert(core)
					.values({ id: 1, contentMd: data.core, updatedAt: new Date() })
					.onConflictDoUpdate({
						target: core.id,
						set: { contentMd: data.core, updatedAt: new Date() },
					})
					.run();
				summary.core = "set";
			}
		}

		for (const batch of chunks(data.messages, 400)) {
			tx.insert(messages)
				.values(
					batch.map((m) => ({
						day: m.day,
						role: m.role,
						kind: m.kind,
						content: m.content,
						mediaUrl: m.mediaUrl,
						...(m.createdAt ? { createdAt: m.createdAt } : {}),
					})),
				)
				.run();
			summary.messages += batch.length;
		}

		for (const batch of chunks(data.memories, 400)) {
			tx.insert(memories)
				.values(
					batch.map((m) => ({
						content: m.content,
						tags: m.tags,
						...(m.createdAt ? { createdAt: m.createdAt } : {}),
					})),
				)
				.run();
			summary.memories += batch.length;
		}

		for (const s of data.summaries) {
			tx.insert(dailySummaries)
				.values({
					day: s.day,
					summaryMd: s.summaryMd,
					...(s.createdAt ? { createdAt: s.createdAt } : {}),
				})
				.onConflictDoUpdate({
					target: dailySummaries.day,
					set: { summaryMd: s.summaryMd },
				})
				.run();
			summary.summaries++;
		}

		for (const batch of chunks(data.notes, 400)) {
			tx.insert(notes)
				.values(
					batch.map((n) => ({
						title: n.title,
						contentMd: n.contentMd,
						...(n.createdAt ? { createdAt: n.createdAt } : {}),
					})),
				)
				.run();
			summary.notes += batch.length;
		}
	});

	return summary;
}

// --- CLI ----------------------------------------------------------------------

function describePlan(data: ImportData): string {
	return [
		`  core.md              ${data.core === undefined ? "—" : "present"}`,
		`  messages.jsonl       ${data.messages.length}`,
		`  memories.json        ${data.memories.length}`,
		`  daily-summaries.json ${data.summaries.length}`,
		`  notes.json           ${data.notes.length}`,
	].join("\n");
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const flags = new Set(argv.filter((a) => a.startsWith("--")));
	const positional = argv.filter((a) => !a.startsWith("--"));

	if (flags.has("--help")) {
		console.log(
			"Usage: bun run import [dir] [--dry-run] [--force] [--strict]\n\n" +
				"  dir         interchange directory (default ./import)\n" +
				"  --dry-run   parse and validate only; write nothing\n" +
				"  --force     import even if the database already has data\n" +
				"  --strict    abort if any record fails validation\n\n" +
				"See docs/importing.md for the file format.",
		);
		process.exit(0);
	}

	const rawDir = positional[0] ?? "./import";
	const dir = isAbsolute(rawDir) ? rawDir : resolve(process.cwd(), rawDir);
	if (!existsSync(dir)) {
		console.error(`✗ Import directory not found: ${dir}`);
		console.error("  Create it (see docs/importing.md) or pass a path.");
		process.exit(1);
	}

	console.log(`Reading interchange files from ${dir}\n`);
	const { data, errors } = loadImportDir(dir, config.app.timezone);

	console.log(describePlan(data));

	if (errors.length) {
		console.error(`\n${errors.length} record(s) failed validation:`);
		for (const e of errors.slice(0, 50)) console.error(`  • ${e}`);
		if (errors.length > 50) console.error(`  … and ${errors.length - 50} more`);
		if (flags.has("--strict")) {
			console.error("\n✗ --strict: aborting without writing.");
			process.exit(1);
		}
		console.error(
			"\n(skipping the above; re-run with --strict to abort instead)",
		);
	}

	if (flags.has("--dry-run")) {
		console.log("\n✓ Dry run — nothing written.");
		process.exit(0);
	}

	const { db } = await import("#/db/index.ts");
	try {
		const s = importAll(db, data, { force: flags.has("--force") });
		console.log(
			`\n✓ Imported into ${config.app.dataDir}:\n` +
				`  core ${s.core}, ${s.messages} messages, ${s.memories} memories, ` +
				`${s.summaries} summaries, ${s.notes} notes.`,
		);
	} catch (err) {
		console.error(`\n✗ ${(err as Error).message}`);
		process.exit(1);
	}
}
