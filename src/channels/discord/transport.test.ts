import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import {
	type AudioPlayerLike,
	DiscordCallTransport,
	type OpusPacketStream,
	type VoiceConnectionLike,
	type VoiceReceiverLike,
} from "./transport.ts";

// Obviously fake snowflakes — never a real Discord id.
const OWNER_ID = "100000000000000001";
const BYSTANDER_ID = "100000000000000002";

/** A stand-in for an `AudioReceiveStream`, driven by hand from the test. */
class FakeStream extends EventEmitter implements OpusPacketStream {
	destroyed = false;
	destroy(): void {
		this.destroyed = true;
		this.emit("end");
	}
}

class FakeReceiver implements VoiceReceiverLike {
	readonly speaking = new EventEmitter();
	readonly subscribed: string[] = [];
	readonly streams: FakeStream[] = [];

	subscribe(userId: string): OpusPacketStream {
		this.subscribed.push(userId);
		const stream = new FakeStream();
		this.streams.push(stream);
		return stream;
	}
}

class FakePlayer extends EventEmitter implements AudioPlayerLike {
	readonly played: unknown[] = [];
	stops = 0;

	play(resource: unknown): void {
		this.played.push(resource);
	}
	stop(): boolean {
		this.stops++;
		// A real player goes idle after a stop; the transport must have settled
		// the cut item before that lands.
		queueMicrotask(() => this.emit("idle"));
		return true;
	}
	/** Test hook: the resource reached its natural end. */
	finish(): void {
		this.emit("idle");
	}
}

class FakeConnection implements VoiceConnectionLike {
	readonly receiver = new FakeReceiver();
	destroyed = 0;
	subscribedPlayer: unknown = null;

	subscribe(player: unknown): unknown {
		this.subscribedPlayer = player;
		return null;
	}
	destroy(): void {
		this.destroyed++;
	}
}

function makeTransport(overrides: { withListener?: boolean } = {}) {
	const connection = new FakeConnection();
	const player = new FakePlayer();
	const transport = new DiscordCallTransport({
		connection,
		player,
		ownerUserId: OWNER_ID,
		createResource: (audio, format) => ({ audio, format }),
		// No Opus in the tests: the "decoder" is a pass-through, so the bytes the
		// test writes are the PCM the resampler sees.
		decodeOpus: (s) => s,
		log: () => {},
	});
	const frames: number[] = [];
	if (overrides.withListener)
		transport.onOwnerAudio((f) => frames.push(f.samples.length));
	return { connection, player, transport, frames };
}

describe("DiscordCallTransport receive", () => {
	it("subscribes to the owner and to nobody else", () => {
		const { connection, transport } = makeTransport();
		transport.onOwnerAudio(() => {});

		connection.receiver.speaking.emit("start", BYSTANDER_ID);
		connection.receiver.speaking.emit("start", "100000000000000003");
		connection.receiver.speaking.emit("start", OWNER_ID);

		expect(connection.receiver.subscribed).toEqual([OWNER_ID]);
		expect(connection.receiver.subscribed).not.toContain(BYSTANDER_ID);
	});

	it("never subscribes twice while one owner stream is open", () => {
		const { connection, transport } = makeTransport();
		transport.onOwnerAudio(() => {});
		connection.receiver.speaking.emit("start", OWNER_ID);
		connection.receiver.speaking.emit("start", OWNER_ID);

		expect(connection.receiver.subscribed).toEqual([OWNER_ID]);
	});

	it("resubscribes after the owner's stream ends, still owner-only", () => {
		const { connection, transport } = makeTransport();
		transport.onOwnerAudio(() => {});
		connection.receiver.speaking.emit("start", OWNER_ID);
		connection.receiver.streams[0]?.emit("end");
		connection.receiver.speaking.emit("start", BYSTANDER_ID);
		connection.receiver.speaking.emit("start", OWNER_ID);

		expect(connection.receiver.subscribed).toEqual([OWNER_ID, OWNER_ID]);
	});

	it("hands the listener 16 kHz mono frames", () => {
		const { connection, transport } = makeTransport();
		const rates: number[] = [];
		let samples = 0;
		transport.onOwnerAudio((frame) => {
			rates.push(frame.sampleRate);
			samples += frame.samples.length;
		});
		connection.receiver.speaking.emit("start", OWNER_ID);

		// 960 stereo frames of 48 kHz audio → 960 mono samples → 320 at 16 kHz.
		const stereo = Buffer.alloc(960 * 2 * 2);
		for (let i = 0; i < 960 * 2; i++) stereo.writeInt16LE(1000, i * 2);
		connection.receiver.streams[0]?.emit("data", stereo);

		expect(rates.every((r) => r === 16_000)).toBe(true);
		expect(samples).toBe(320);
	});

	it("stops delivering audio once the listener unsubscribes", () => {
		const { connection, transport } = makeTransport();
		let calls = 0;
		const off = transport.onOwnerAudio(() => calls++);
		connection.receiver.speaking.emit("start", OWNER_ID);
		const stereo = Buffer.alloc(960 * 2 * 2);
		connection.receiver.streams[0]?.emit("data", stereo);
		const afterFirst = calls;
		off();
		connection.receiver.streams[0]?.emit("data", stereo);

		expect(afterFirst).toBe(1);
		expect(calls).toBe(1);
	});
});

describe("DiscordCallTransport playback", () => {
	it('resolves "played" when the resource finishes', async () => {
		const { player, transport } = makeTransport();
		const done = transport.play(new Uint8Array([1, 2, 3]), "opus");
		expect(player.played.length).toBe(1);

		player.finish();
		expect(await done).toBe("played");
	});

	it('resolves "cut" when stopPlayback interrupts it', async () => {
		const { player, transport } = makeTransport();
		const done = transport.play(new Uint8Array([1]), "opus");
		transport.stopPlayback();

		expect(await done).toBe("cut");
		expect(player.stops).toBe(1);
	});

	it("cuts the queued remainder too, and plays nothing more", async () => {
		const { player, transport } = makeTransport();
		const first = transport.play(new Uint8Array([1]), "opus");
		const second = transport.play(new Uint8Array([2]), "opus");
		const third = transport.play(new Uint8Array([3]), "opus");
		transport.stopPlayback();

		expect(await Promise.all([first, second, third])).toEqual([
			"cut",
			"cut",
			"cut",
		]);
		// Only the first ever reached the player; the idle that a stop provokes
		// must not start the dropped queue.
		await Promise.resolve();
		expect(player.played.length).toBe(1);
	});

	it("plays a queue in order, one at a time", async () => {
		const { player, transport } = makeTransport();
		const first = transport.play(new Uint8Array([1]), "opus");
		const second = transport.play(new Uint8Array([2]), "opus");

		expect(player.played.length).toBe(1);
		player.finish();
		expect(await first).toBe("played");
		expect(player.played.length).toBe(2);
		player.finish();
		expect(await second).toBe("played");
	});

	it("reports a resource that cannot be built as cut", async () => {
		const connection = new FakeConnection();
		const player = new FakePlayer();
		const transport = new DiscordCallTransport({
			connection,
			player,
			ownerUserId: OWNER_ID,
			createResource: () => {
				throw new Error("no encoder");
			},
			decodeOpus: (s) => s,
			log: () => {},
		});

		expect(await transport.play(new Uint8Array([1]), "wav")).toBe("cut");
	});

	it("cuts in-flight speech on close and leaves the channel once", async () => {
		const { connection, transport } = makeTransport();
		const done = transport.play(new Uint8Array([1]), "opus");
		await transport.close();
		await transport.close();

		expect(await done).toBe("cut");
		expect(connection.destroyed).toBe(1);
		expect(await transport.play(new Uint8Array([2]), "opus")).toBe("cut");
	});
});
