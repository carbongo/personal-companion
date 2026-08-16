import { describe, expect, it } from "bun:test";
import type { UtteranceEvent } from "#/companion-core/call/framing.ts";
import { UtteranceFramer } from "#/companion-core/call/framing.ts";
import type { PcmFrame } from "#/companion-core/call/types.ts";

const FRAME = 512;
const FRAME_MS = (FRAME / 16_000) * 1000; // 32ms

/** A frame whose samples are a constant, so the audio is identifiable in the output. */
function frame(value: number): PcmFrame {
	return { samples: new Int16Array(FRAME).fill(value), sampleRate: 16_000 };
}

/** Feed a probability sequence and collect everything it produced. */
function run(
	framer: UtteranceFramer,
	probs: number[],
	value = 1,
): UtteranceEvent[] {
	const events: UtteranceEvent[] = [];
	for (const p of probs) events.push(...framer.push(frame(value), p));
	return events;
}

const speech = (n: number) => Array(n).fill(1);
const quiet = (n: number) => Array(n).fill(0);

describe("UtteranceFramer", () => {
	it("opens only after enough consecutive speech frames", () => {
		const framer = new UtteranceFramer({ speechFrames: 3 });
		expect(run(framer, [1, 1])).toHaveLength(0);
		expect(framer.isSpeaking).toBe(false);
		expect(run(framer, [1])).toEqual([{ type: "utterance-start" }]);
		expect(framer.isSpeaking).toBe(true);
	});

	it("does not open on a scattering of speech frames", () => {
		const framer = new UtteranceFramer({ speechFrames: 3 });
		expect(run(framer, [1, 0, 1, 0, 1, 0, 1, 1, 0])).toHaveLength(0);
	});

	it("survives a single dropped frame mid-word", () => {
		const framer = new UtteranceFramer({ speechFrames: 3, silenceFrames: 5 });
		const events = run(framer, [
			...speech(3),
			...quiet(4),
			...speech(10),
			...quiet(4),
		]);
		expect(events).toEqual([{ type: "utterance-start" }]);
		expect(framer.isSpeaking).toBe(true);
	});

	it("closes after the silence run and hands back the audio", () => {
		const framer = new UtteranceFramer({
			speechFrames: 3,
			silenceFrames: 5,
			prerollFrames: 3,
		});
		const events = run(framer, [...speech(20), ...quiet(5)]);

		expect(events[0]).toEqual({ type: "utterance-start" });
		const end = events[1];
		if (end?.type !== "utterance-end") throw new Error("expected an end event");

		// 3 pre-roll frames + 17 while open + 5 of closing silence.
		expect(end.samples.length).toBe(25 * FRAME);
		expect(end.durationMs).toBeCloseTo(25 * FRAME_MS, 3);
		expect(end.sampleRate).toBe(16_000);
		expect(end.reason).toBe("silence");
		expect(framer.isSpeaking).toBe(false);
	});

	it("keeps the pre-roll so the onset is not clipped", () => {
		const framer = new UtteranceFramer({
			speechFrames: 2,
			silenceFrames: 3,
			prerollFrames: 4,
			minSpeechMs: 0,
		});
		// Two quiet frames of context, then speech: all six should come back.
		const events = [
			...framer.push(frame(7), 0),
			...framer.push(frame(7), 0),
			...framer.push(frame(9), 1),
			...framer.push(frame(9), 1),
			...framer.push(frame(9), 0),
			...framer.push(frame(9), 0),
			...framer.push(frame(9), 0),
		];
		const end = events.at(-1);
		if (end?.type !== "utterance-end") throw new Error("expected an end event");
		expect(end.samples.length).toBe(7 * FRAME);
		expect(end.samples[0]).toBe(7);
	});

	it("discards a click: long enough in wall time, too little speech", () => {
		const framer = new UtteranceFramer({
			speechFrames: 2,
			silenceFrames: 6,
			minSpeechMs: 250,
		});
		const events = run(framer, [...speech(2), ...quiet(6)]);
		expect(events[0]).toEqual({ type: "utterance-start" });
		const last = events[1];
		if (last?.type !== "utterance-discarded")
			throw new Error("expected the click to be discarded");
		expect(last.durationMs).toBeGreaterThan(250);
	});

	it("keeps an utterance that clears the minimum speech duration", () => {
		const framer = new UtteranceFramer({
			speechFrames: 2,
			silenceFrames: 6,
			minSpeechMs: 250,
		});
		const events = run(framer, [...speech(12), ...quiet(6)]);
		expect(events.at(-1)?.type).toBe("utterance-end");
	});

	it("closes a stuck-open mic at the ceiling", () => {
		const framer = new UtteranceFramer({
			speechFrames: 2,
			silenceFrames: 100,
			maxUtteranceMs: 500,
		});
		const events = run(framer, speech(16));
		const end = events.at(-1);
		if (end?.type !== "utterance-end") throw new Error("expected an end event");
		expect(end.reason).toBe("max-duration");
		expect(end.durationMs).toBeGreaterThanOrEqual(500);
		expect(end.durationMs).toBeLessThan(500 + FRAME_MS);
		expect(framer.isSpeaking).toBe(false);
	});

	it("flushes what is open when the call ends, and nothing when idle", () => {
		const framer = new UtteranceFramer({ speechFrames: 2, minSpeechMs: 0 });
		expect(framer.flush()).toEqual([]);
		run(framer, speech(10));
		expect(framer.flush().at(0)?.type).toBe("utterance-end");
		expect(framer.flush()).toEqual([]);
	});

	it("reset drops a half-captured utterance", () => {
		const framer = new UtteranceFramer({ speechFrames: 2 });
		run(framer, speech(10));
		framer.reset();
		expect(framer.isSpeaking).toBe(false);
		expect(framer.bufferedMs).toBe(0);
		expect(framer.flush()).toEqual([]);
	});

	it("frames a second utterance after the first", () => {
		const framer = new UtteranceFramer({
			speechFrames: 2,
			silenceFrames: 4,
			minSpeechMs: 0,
		});
		const events = run(framer, [
			...speech(10),
			...quiet(4),
			...speech(10),
			...quiet(4),
		]);
		expect(events.map((e) => e.type)).toEqual([
			"utterance-start",
			"utterance-end",
			"utterance-start",
			"utterance-end",
		]);
	});
});
