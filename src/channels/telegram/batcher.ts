/**
 * Incoming-message batching. People fire off several quick messages in a row
 * ("hey" / "you there" / "wanted to ask…"); replying to each is robotic and
 * wasteful. The batcher debounces a burst per chat into a single turn.
 *
 * The idle window is *dynamic*: the more messages arrive, the longer it waits
 * for the next one — `idleMs` after the first message, growing by `stepMs` with
 * each further message, capped at `maxMs`. So a one-off message flushes quickly,
 * while someone clearly mid-thought gets more breathing room (up to the ceiling).
 * There is no absolute cap from the first message — the only bound is that the
 * per-gap window never exceeds `maxMs`. Timing is injected so it is easy to test.
 */

/** One normalized inbound item; the channel combines a batch into one turn. */
export interface BatchItem {
	text: string;
	images: string[];
	kind: "text" | "voice" | "photo";
	mediaUrl: string | null;
}

type FlushFn = (chatId: number, items: BatchItem[]) => void | Promise<void>;

interface Pending {
	items: BatchItem[];
	idleTimer: ReturnType<typeof setTimeout>;
}

/**
 * The idle window to wait after the `count`-th message of a burst (1-based):
 * `idleMs` for the first, growing by `stepMs` each further message, capped at
 * `maxMs`. e.g. (10s, 2s, 16s) → 10, 12, 14, 16, 16, …
 */
export function idleWindow(
	count: number,
	idleMs: number,
	stepMs: number,
	maxMs: number,
): number {
	return Math.min(idleMs + stepMs * Math.max(0, count - 1), maxMs);
}

export class Batcher {
	private readonly pending = new Map<number, Pending>();

	constructor(
		private readonly idleMs: number,
		private readonly stepMs: number,
		private readonly maxMs: number,
		private readonly onFlush: FlushFn,
	) {}

	/** Add an item to a chat's batch, (re)arming the idle timer — grown by count. */
	add(chatId: number, item: BatchItem): void {
		const existing = this.pending.get(chatId);
		if (existing) clearTimeout(existing.idleTimer);
		const items = existing?.items ?? [];
		items.push(item);
		const wait = idleWindow(items.length, this.idleMs, this.stepMs, this.maxMs);
		const idleTimer = setTimeout(() => this.flush(chatId), wait);
		this.pending.set(chatId, { items, idleTimer });
	}

	private flush(chatId: number): void {
		const p = this.pending.get(chatId);
		if (!p) return;
		clearTimeout(p.idleTimer);
		this.pending.delete(chatId);
		void this.onFlush(chatId, p.items);
	}

	/** Drop all pending batches without flushing (e.g. on shutdown). */
	clear(): void {
		for (const p of this.pending.values()) clearTimeout(p.idleTimer);
		this.pending.clear();
	}
}
