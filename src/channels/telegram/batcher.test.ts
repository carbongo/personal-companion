import { describe, expect, it } from "bun:test";

import { Batcher, type BatchItem, idleWindow } from "./batcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function item(text: string): BatchItem {
	return { text, images: [], kind: "text", mediaUrl: null };
}

describe("idleWindow", () => {
	it("grows by step per message and caps at max", () => {
		// the canonical example: 10s base, +2s each, ceiling 16s
		expect(idleWindow(1, 10, 2, 16)).toBe(10);
		expect(idleWindow(2, 10, 2, 16)).toBe(12);
		expect(idleWindow(3, 10, 2, 16)).toBe(14);
		expect(idleWindow(4, 10, 2, 16)).toBe(16);
		expect(idleWindow(5, 10, 2, 16)).toBe(16); // capped
		expect(idleWindow(99, 10, 2, 16)).toBe(16);
	});

	it("with step 0 is a plain fixed window", () => {
		expect(idleWindow(1, 30, 0, 100)).toBe(30);
		expect(idleWindow(5, 30, 0, 100)).toBe(30);
	});
});

describe("Batcher", () => {
	it("flushes a single message after the base idle window", async () => {
		const flushes: BatchItem[][] = [];
		const b = new Batcher(40, 20, 200, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a"));
		await sleep(20); // still inside the base window
		expect(flushes.length).toBe(0);

		await sleep(50); // base window elapsed
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.map((i) => i.text)).toEqual(["a"]);
	});

	it("grows the window as messages arrive (stays open past the base idle)", async () => {
		const flushes: BatchItem[][] = [];
		const b = new Batcher(50, 80, 500, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a")); // window 50
		await sleep(30);
		b.add(1, item("b")); // window now 50 + 80 = 130
		await sleep(70); // 70ms since "b": a fixed-50 window would have flushed; this hasn't
		expect(flushes.length).toBe(0);

		await sleep(120); // ~190ms since "b" > 130
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.length).toBe(2);
	});

	it("caps the window at maxMs even with a large step", async () => {
		const flushes: BatchItem[][] = [];
		// huge step, but the ceiling clamps the window to 60ms.
		const b = new Batcher(40, 1000, 60, (_chat, items) => {
			flushes.push(items);
		});

		b.add(1, item("a"));
		b.add(1, item("b")); // window = min(40 + 1000, 60) = 60
		await sleep(120); // well past 60ms, far short of 1040ms
		expect(flushes.length).toBe(1);
		expect(flushes[0]?.length).toBe(2);
	});

	it("batches each chat independently", async () => {
		const byChat: Record<number, number> = {};
		const b = new Batcher(30, 10, 200, (chat, items) => {
			byChat[chat] = items.length;
		});

		b.add(1, item("a"));
		b.add(2, item("x"));
		b.add(2, item("y"));
		await sleep(90);
		expect(byChat[1]).toBe(1);
		expect(byChat[2]).toBe(2);
	});

	it("clear() cancels pending batches without flushing", async () => {
		let flushed = false;
		const b = new Batcher(30, 10, 200, () => {
			flushed = true;
		});
		b.add(1, item("a"));
		b.clear();
		await sleep(60);
		expect(flushed).toBe(false);
	});
});
