import { beforeEach, describe, expect, it } from "bun:test";

import { getDigest, upsertDigest } from "#/companion-core/memory/store.ts";
import { db } from "#/db/index.ts";
import { digests } from "#/db/schema.ts";
import { api } from "./api.ts";

describe("digests API", () => {
	beforeEach(() => {
		db.delete(digests).run();
		upsertDigest("week", "2030-03-04", "2030-03-10", "- a week");
		upsertDigest("month", "2030-02-01", "2030-02-28", "- a month");
	});

	it("lists weeks and months, newest first", async () => {
		const res = await api.request("/digests");
		const { digests: list } = (await res.json()) as {
			digests: { kind: string; start: string; summary: string }[];
		};
		expect(list.map((d) => `${d.kind}:${d.start}`)).toEqual([
			"week:2030-03-04",
			"month:2030-02-01",
		]);
	});

	it("saves a hand edit and keeps the period", async () => {
		const res = await api.request("/digests/week/2030-03-04", {
			method: "PUT",
			body: JSON.stringify({ summary: "- corrected" }),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(200);
		const d = getDigest("week", "2030-03-04");
		expect(d?.summaryMd).toBe("- corrected");
		expect(d?.end).toBe("2030-03-10");
	});

	it("refuses an edit to a digest that doesn't exist", async () => {
		const res = await api.request("/digests/year/2030-01-01", {
			method: "PUT",
			body: JSON.stringify({ summary: "x" }),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(404);
	});

	it("drops a digest so the next roll-up rewrites it", async () => {
		await api.request("/digests/month/2030-02-01", { method: "DELETE" });
		expect(getDigest("month", "2030-02-01")).toBeNull();
	});
});
