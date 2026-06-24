import { describe, expect, it } from "bun:test";

import { Batcher, type BatchItem } from "./batcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function item(text: string): BatchItem {
	return { text, images: [], kind: "text", mediaUrl: null };
}

describe("Batcher", () => {
	it("debounces a burst into a single flush after the idle window", async () => {
		const flushes: BatchItem[][] = [];
		const b = new Batcher(40, 1000, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a"));
		b.add(1, item("b"));
		b.add(1, item("c"));
		await sleep(20); // still inside idle window
		expect(flushes.length).toBe(0);

		await sleep(60); // idle window elapsed
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.map((i) => i.text)).toEqual(["a", "b", "c"]);
	});

	it("keeps the batch alive while messages keep arriving", async () => {
		const flushes: BatchItem[][] = [];
		const b = new Batcher(40, 1000, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a"));
		await sleep(25);
		b.add(1, item("b")); // resets idle before it fired
		await sleep(25);
		expect(flushes.length).toBe(0);

		await sleep(40);
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.length).toBe(2);
	});

	it("force-flushes at the hard cap even during a continuous burst", async () => {
		const flushes: BatchItem[][] = [];
		// idle never fires (large); max cap is short.
		const b = new Batcher(1000, 60, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a"));
		b.add(1, item("b"));
		await sleep(100); // past the 60ms cap
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.length).toBe(2);
	});

	it("batches each chat independently", async () => {
		const byChat: Record<number, number> = {};
		const b = new Batcher(30, 1000, (chat, items) => {
			byChat[chat] = items.length;
		});

		b.add(1, item("a"));
		b.add(2, item("x"));
		b.add(2, item("y"));
		await sleep(60);
		expect(byChat[1]).toBe(1);
		expect(byChat[2]).toBe(2);
	});

	it("clear() cancels pending batches without flushing", async () => {
		let flushed = false;
		const b = new Batcher(30, 1000, () => {
			flushed = true;
		});
		b.add(1, item("a"));
		b.clear();
		await sleep(60);
		expect(flushed).toBe(false);
	});
});
