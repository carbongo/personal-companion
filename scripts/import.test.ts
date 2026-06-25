import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { createDb, type DB } from "#/db/index.ts";
import { core, dailySummaries, memories, messages } from "#/db/schema.ts";

import {
	type ImportData,
	importAll,
	loadImportDir,
	parseTimestamp,
} from "./import.ts";

function emptyData(): ImportData {
	return { messages: [], memories: [], summaries: [] };
}

describe("parseTimestamp", () => {
	test("ISO string", () => {
		const d = parseTimestamp("2024-01-02T03:04:05.000Z");
		expect(d?.toISOString()).toBe("2024-01-02T03:04:05.000Z");
	});

	test("epoch millis as number and as digit string", () => {
		expect(parseTimestamp(1_700_000_000_000)?.getTime()).toBe(
			1_700_000_000_000,
		);
		expect(parseTimestamp("1700000000000")?.getTime()).toBe(1_700_000_000_000);
	});

	test("garbage and missing values are undefined", () => {
		expect(parseTimestamp("not-a-date")).toBeUndefined();
		expect(parseTimestamp("")).toBeUndefined();
		expect(parseTimestamp(null)).toBeUndefined();
		expect(parseTimestamp(undefined)).toBeUndefined();
	});
});

describe("importAll", () => {
	let db: DB;
	beforeEach(() => {
		db = createDb(":memory:");
	});

	test("imports each table and preserves timestamps", () => {
		const ts = new Date("2024-01-02T03:04:05.000Z");
		const data: ImportData = {
			core: "# Core\nThe spine.",
			messages: [
				{
					day: "2024-01-02",
					role: "user",
					kind: "text",
					content: "hello",
					mediaUrl: null,
					createdAt: ts,
				},
			],
			memories: [{ content: "likes tea", tags: "pref", createdAt: ts }],
			summaries: [{ day: "2024-01-01", summaryMd: "a quiet day" }],
		};

		const s = importAll(db, data);
		expect(s).toEqual({
			core: "set",
			messages: 1,
			memories: 1,
			summaries: 1,
		});

		const msg = db.select().from(messages).all();
		expect(msg).toHaveLength(1);
		expect(msg[0]?.day).toBe("2024-01-02");
		expect(msg[0]?.content).toBe("hello");
		expect(msg[0]?.createdAt.getTime()).toBe(ts.getTime());

		expect(db.select().from(memories).all()[0]?.createdAt.getTime()).toBe(
			ts.getTime(),
		);
		expect(
			db.select({ c: core.contentMd }).from(core).where(eq(core.id, 1)).get()
				?.c,
		).toBe("# Core\nThe spine.");
		expect(db.select().from(dailySummaries).all()[0]?.summaryMd).toBe(
			"a quiet day",
		);
	});

	test("daily summaries upsert by day", () => {
		importAll(db, {
			...emptyData(),
			summaries: [{ day: "2024-01-01", summaryMd: "first" }],
		});
		importAll(db, {
			...emptyData(),
			summaries: [{ day: "2024-01-01", summaryMd: "second" }],
		});
		const rows = db.select().from(dailySummaries).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.summaryMd).toBe("second");
	});

	test("refuses to duplicate existing history without --force", () => {
		const msg: ImportData = {
			...emptyData(),
			messages: [
				{
					day: "2024-01-02",
					role: "user",
					kind: "text",
					content: "hi",
					mediaUrl: null,
				},
			],
		};
		importAll(db, msg);
		expect(() => importAll(db, msg)).toThrow(/already has messages/);
		// force lets it through (and rolls the count forward)
		importAll(db, msg, { force: true });
		expect(db.select().from(messages).all()).toHaveLength(2);
	});

	test("core is not overwritten unless forced", () => {
		importAll(db, { ...emptyData(), core: "original" });
		const s = importAll(db, { ...emptyData(), core: "replacement" });
		expect(s.core).toBe("skipped");
		expect(
			db.select({ c: core.contentMd }).from(core).where(eq(core.id, 1)).get()
				?.c,
		).toBe("original");

		const forced = importAll(
			db,
			{ ...emptyData(), core: "replacement" },
			{
				force: true,
			},
		);
		expect(forced.core).toBe("set");
	});
});

describe("loadImportDir", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pc-import-"));
	});

	test("reads files, derives day from createdAt, reports bad records", () => {
		writeFileSync(join(dir, "core.md"), "# Core");
		writeFileSync(
			join(dir, "messages.jsonl"),
			[
				// day derived from the timestamp (UTC)
				'{"role":"user","content":"hi","createdAt":"2024-03-10T23:30:00.000Z"}',
				// bad: no role
				'{"content":"orphan"}',
				// bad: not JSON
				"{not json}",
			].join("\n"),
		);
		writeFileSync(
			join(dir, "memories.json"),
			JSON.stringify([{ content: "ok" }, { tags: "no-content" }]),
		);

		const { data, errors } = loadImportDir(dir, "UTC");
		expect(data.core).toBe("# Core");
		expect(data.messages).toHaveLength(1);
		expect(data.messages[0]?.day).toBe("2024-03-10");
		expect(data.memories).toHaveLength(1);
		// two bad messages + one bad memory
		expect(errors.length).toBe(3);
	});

	test("missing files just yield empty collections", () => {
		const empty = mkdtempSync(join(tmpdir(), "pc-import-empty-"));
		const { data, errors } = loadImportDir(empty, "UTC");
		expect(errors).toHaveLength(0);
		expect(data.core).toBeUndefined();
		expect(data.messages).toHaveLength(0);
	});
});
