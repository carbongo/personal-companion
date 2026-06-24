/**
 * Incoming-message batching. People fire off several quick messages in a row
 * ("hey" / "you there" / "wanted to ask…"); replying to each is robotic and
 * wasteful. The batcher debounces a burst per chat into a single turn: it
 * flushes after `idleMs` of silence, but never holds a batch longer than
 * `maxMs` from its first message. Timing is injected so it is easy to test.
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
	maxTimer: ReturnType<typeof setTimeout>;
}

export class Batcher {
	private readonly pending = new Map<number, Pending>();

	constructor(
		private readonly idleMs: number,
		private readonly maxMs: number,
		private readonly onFlush: FlushFn,
	) {}

	/** Add an item to a chat's batch, (re)arming the idle timer. */
	add(chatId: number, item: BatchItem): void {
		const existing = this.pending.get(chatId);
		if (!existing) {
			this.pending.set(chatId, {
				items: [item],
				idleTimer: setTimeout(() => this.flush(chatId), this.idleMs),
				maxTimer: setTimeout(() => this.flush(chatId), this.maxMs),
			});
			return;
		}
		existing.items.push(item);
		clearTimeout(existing.idleTimer);
		existing.idleTimer = setTimeout(() => this.flush(chatId), this.idleMs);
	}

	private flush(chatId: number): void {
		const p = this.pending.get(chatId);
		if (!p) return;
		clearTimeout(p.idleTimer);
		clearTimeout(p.maxTimer);
		this.pending.delete(chatId);
		void this.onFlush(chatId, p.items);
	}

	/** Drop all pending batches without flushing (e.g. on shutdown). */
	clear(): void {
		for (const p of this.pending.values()) {
			clearTimeout(p.idleTimer);
			clearTimeout(p.maxTimer);
		}
		this.pending.clear();
	}
}
