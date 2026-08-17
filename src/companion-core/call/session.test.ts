import { describe, expect, it } from "bun:test";
import type { TranscriptionResult } from "#/channels/stt.ts";
import {
	ENGINE_SAMPLE_RATE,
	VAD_FRAME_SIZE,
} from "#/companion-core/call/resample.ts";
import {
	CallSession,
	type CallSessionOptions,
	detectAudioFormat,
	encodeWav,
} from "#/companion-core/call/session.ts";
import type {
	AudioFormat,
	CallTransport,
	PcmFrame,
	PlaybackResult,
	VoiceActivityDetector,
} from "#/companion-core/call/types.ts";
import type { EngineReply, Turn } from "#/companion-core/engine.ts";
import {
	appendMessage,
	messagesForDay,
} from "#/companion-core/memory/store.ts";

/**
 * The transport is an interface precisely so the session can be driven like
 * this: synthetic frames in, recorded playback out, and playback results the
 * test decides — which is the only way to test barge-in without a voice channel.
 */
class FakeTransport implements CallTransport {
	listener: ((frame: PcmFrame) => void) | null = null;
	plays: { text: string; format: AudioFormat }[] = [];
	stopped = 0;
	closed = 0;
	throwOnPlay = false;
	/** Playbacks from this index on hang until stopPlayback / resolvePending. */
	manualFrom = Number.POSITIVE_INFINITY;
	private waiting: ((result: PlaybackResult) => void)[] = [];

	onOwnerAudio(listener: (frame: PcmFrame) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = null;
		};
	}

	play(audio: Uint8Array, format: AudioFormat): Promise<PlaybackResult> {
		if (this.throwOnPlay) throw new Error("no voice connection");
		const index = this.plays.length;
		this.plays.push({ text: new TextDecoder().decode(audio), format });
		if (index < this.manualFrom) return Promise.resolve("played");
		return new Promise((resolve) => this.waiting.push(resolve));
	}

	stopPlayback(): void {
		this.stopped++;
		for (const resolve of this.waiting.splice(0)) resolve("cut");
	}

	async close(): Promise<void> {
		this.closed++;
	}

	/** Finish whatever is still hanging, as if it had run to the end. */
	resolvePending(result: PlaybackResult): void {
		for (const resolve of this.waiting.splice(0)) resolve(result);
	}

	emit(frame: PcmFrame): void {
		this.listener?.(frame);
	}
}

/** A detector that reads the frame it is given: loud samples are speech. */
class AmplitudeVad implements VoiceActivityDetector {
	readonly name = "amplitude";
	frames = 0;
	process(frame: PcmFrame): number {
		this.frames++;
		return (frame.samples[0] ?? 0) !== 0 ? 0.95 : 0.02;
	}
	reset(): void {}
}

const frameOf = (value: number): PcmFrame => ({
	samples: new Int16Array(VAD_FRAME_SIZE).fill(value),
	sampleRate: ENGINE_SAMPLE_RATE,
});

/** Enough quiet to clear the configured trailing-silence window (700ms / 32ms). */
const SILENCE_FRAMES = 24;

function speech(transport: FakeTransport, frames: number): void {
	for (let i = 0; i < frames; i++) transport.emit(frameOf(12_000));
}

function quiet(transport: FakeTransport, frames: number): void {
	for (let i = 0; i < frames; i++) transport.emit(frameOf(0));
}

/**
 * One complete utterance. 40 speech frames is ~1.3s, comfortably past both the
 * minimum-speech rule and the hallucination gate's words-per-second sanity check.
 */
function utterance(transport: FakeTransport, speechFrames = 40): void {
	speech(transport, speechFrames);
	quiet(transport, SILENCE_FRAMES);
}

/** Let the promise chains inside the session run without advancing real time. */
async function tick(rounds = 40): Promise<void> {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Drain microtasks until `predicate` holds, rather than guessing a tick count. */
async function until(predicate: () => boolean, rounds = 5000): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error("condition never held");
}

interface Harness {
	transport: FakeTransport;
	session: CallSession;
	turns: Turn[];
	timers: { fn: () => void; ms: number }[];
	truncations: { id: number; heard: string }[];
	fire(): void;
}

function harness(
	options: CallSessionOptions & {
		/** A plain string is a transcript nobody measured a confidence for. */
		transcripts?: (string | TranscriptionResult)[];
		clauses?: string[];
		messageId?: number;
		onEmitted?: (transport: FakeTransport) => void;
	} = {},
): Harness {
	const transport = new FakeTransport();
	const turns: Turn[] = [];
	const timers: { fn: () => void; ms: number }[] = [];
	const truncations: { id: number; heard: string }[] = [];
	const transcripts = [...(options.transcripts ?? [])];
	const clauses = options.clauses ?? ["A perfectly ordinary reply, spoken."];

	const session = new CallSession(transport, {
		vad: new AmplitudeVad(),
		// Snappier onset than the defaults so a test utterance is a handful of
		// frames; the silence window stays as configured, since it is what the
		// endpointer is told about.
		framing: { speechFrames: 2, prerollFrames: 1, minSpeechMs: 60 },
		// Patience is pinned rather than left to whichever CALL_PATIENCE_* the
		// environment carries. Zero base patience means an utterance with no
		// unfinished-speech signal commits the moment the framer closes it, so the
		// tests that are not about patience never have to fire a timer; the ones
		// that are about it exercise the extended wait, which stays real.
		patience: { basePatienceMs: 0, extendedPatienceMs: 1600, maxWaitMs: 3000 },
		transcribe: async () => {
			const next = transcripts.shift() ?? "";
			return typeof next === "string" ? { text: next } : next;
		},
		synthesize: async (text) => new TextEncoder().encode(text),
		respond: async (turn, emit) => {
			turns.push(turn);
			for (const clause of clauses) await emit(clause);
			options.onEmitted?.(transport);
			const reply: EngineReply = { reply: clauses.join(""), spoken: true };
			if (options.messageId !== undefined) reply.messageId = options.messageId;
			return reply;
		},
		truncateAssistant: (id, heard) => truncations.push({ id, heard }),
		schedule: (fn, ms) => {
			const timer = { fn, ms };
			timers.push(timer);
			return () => {
				const i = timers.indexOf(timer);
				if (i >= 0) timers.splice(i, 1);
			};
		},
		log: () => {},
		...options,
	});
	session.start();

	return {
		transport,
		session,
		turns,
		timers,
		truncations,
		fire() {
			const timer = timers.shift();
			timer?.fn();
		},
	};
}

describe("encodeWav", () => {
	it("wraps PCM in a header STT backends can read", () => {
		const wav = encodeWav(Int16Array.from([0, -1, 32_767]), 16_000);
		expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
		expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe("WAVE");
		expect(wav.length).toBe(44 + 3 * 2);
		const view = new DataView(wav.buffer);
		expect(view.getUint32(24, true)).toBe(16_000); // sample rate
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getInt16(44 + 4, true)).toBe(32_767);
	});
});

describe("detectAudioFormat", () => {
	it("recognises an Ogg container and falls back to wav", () => {
		expect(detectAudioFormat(new TextEncoder().encode("OggS...."))).toBe(
			"opus",
		);
		expect(detectAudioFormat(new TextEncoder().encode("RIFF....WAVE"))).toBe(
			"wav",
		);
		expect(detectAudioFormat(new Uint8Array([1, 2, 3, 4]))).toBe("wav");
	});
});

describe("a full call turn", () => {
	it("takes audio to a transcript, a turn, and clauses played in order", async () => {
		const h = harness({
			transcripts: ["what is the plan for tomorrow?"],
			clauses: ["Nothing much is booked. ", "We could start with the garden."],
		});

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("what is the plan for tomorrow?");
		// Call turns are voice turns, so persona/memory/roll-up need no special case.
		expect(h.turns[0]?.kind).toBe("voice");
		expect(h.transport.plays.map((p) => p.text)).toEqual([
			"Nothing much is booked.",
			"We could start with the garden.",
		]);
		expect(h.session.state).toBe("listening");
		expect(h.truncations).toEqual([]);
	});

	it("leaves history alone when every clause was heard", async () => {
		const day = "2026-08-11";
		const row = appendMessage({
			day,
			role: "assistant",
			kind: "voice",
			content: "All of it was spoken.",
		});
		const h = harness({
			transcripts: ["can you say that again please?"],
			clauses: ["All of it was spoken."],
			messageId: row.id,
			truncateAssistant: undefined,
		});

		utterance(h.transport);
		await h.session.settle();

		const stored = messagesForDay(day).find((m) => m.id === row.id);
		expect(stored?.content).toBe("All of it was spoken.");
	});
});

describe("what never reaches the engine", () => {
	it("drops a backchannel-only utterance", async () => {
		const h = harness({ transcripts: ["yeah"] });
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);
		expect(h.transport.plays).toEqual([]);
	});

	it("drops a transcript the hallucination gate rejects", async () => {
		const h = harness({ transcripts: ["thanks for watching"] });
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);
	});

	it("drops a transcript the decoder was not sure of", async () => {
		const h = harness({
			transcripts: [
				{ text: "tell me about the plan for tomorrow", confidence: 0.2 },
			],
		});
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);
	});

	it("keeps the same words when the decoder was sure of them", async () => {
		// Identical text, identical audio — only the measured confidence differs,
		// which is the whole of what the new signal is allowed to decide.
		const h = harness({
			transcripts: [
				{ text: "tell me about the plan for tomorrow", confidence: 0.93 },
			],
		});
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("tell me about the plan for tomorrow");
	});

	it("keeps a transcript whose confidence nobody measured", async () => {
		// An absent confidence is not a low one: a provider that reports nothing
		// must not silently mute the owner.
		const h = harness({
			transcripts: [{ text: "tell me about the plan for tomorrow" }],
		});
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toHaveLength(1);
	});

	it("survives a transcription failure without ending the call", async () => {
		const h = harness({
			transcribe: async () => {
				throw new Error("whisper is not running");
			},
		});
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);
		expect(h.session.state).toBe("listening");
	});
});

describe("endpointing", () => {
	it("holds the turn open on a trailing hesitation", async () => {
		const h = harness({ transcripts: ["so what i mean is um"] });

		utterance(h.transport);
		await h.session.settle();

		// Nothing committed: "um" is not the end of a thought.
		expect(h.turns).toEqual([]);
		expect(h.timers).toHaveLength(1);
	});

	it("appends the next utterance to the held one", async () => {
		const h = harness({
			transcripts: ["so what i mean is um", "let's go tomorrow"],
		});

		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("so what i mean is um let's go tomorrow");
		// The pending timer was cancelled when the rest of the sentence arrived.
		expect(h.timers).toHaveLength(0);
	});

	it("holds a short declarative whisper tidied up with a full stop", async () => {
		// The owner said half a thought and drew breath. Whisper ends it with a
		// full stop regardless, and answering that is exactly the interruption she
		// complained about — so nothing may reach the engine yet.
		const h = harness({ transcripts: ["I went to the store."] });

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toEqual([]);
		expect(h.transport.plays).toEqual([]);
		expect(h.timers).toHaveLength(1);
	});

	it("joins the held half-thought to the rest of the sentence", async () => {
		const h = harness({
			transcripts: ["I went to the store.", "and got bread"],
		});

		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);

		utterance(h.transport);
		await h.session.settle();

		// One turn, carrying the whole thought — not two halves answered apart.
		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("I went to the store. and got bread");
		expect(h.timers).toHaveLength(0);
	});

	it("still answers a finished sentence without a wait", async () => {
		// The patience must not become a delay on everything: a whole thought,
		// long enough to be one, commits as soon as the utterance closes.
		const h = harness({
			transcripts: ["I finished the report and sent it already."],
		});

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.timers).toEqual([]);
	});

	it("holds a Russian fragment ending on a conjunction", async () => {
		const h = harness({ transcripts: ["я пошла в магазин и", "купила хлеба"] });

		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toEqual([]);

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("я пошла в магазин и купила хлеба");
	});

	it("commits the held text once the owner simply stops", async () => {
		const h = harness({ transcripts: ["so what i mean is um"] });

		utterance(h.transport);
		await h.session.settle();
		expect(h.timers[0]?.ms).toBeGreaterThan(0);

		h.fire();
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.turns[0]?.text).toBe("so what i mean is um");
	});
});

describe("barge-in", () => {
	it("truncates the stored reply to the clauses that were actually played", async () => {
		const day = "2026-08-12";
		const full = "First clause. Second clause. Third clause.";
		const row = appendMessage({
			day,
			role: "assistant",
			kind: "voice",
			content: full,
		});

		const h = harness({
			transcripts: ["tell me about the plan for tomorrow"],
			clauses: ["First clause. ", "Second clause. ", "Third clause."],
			messageId: row.id,
			bargeInFrames: 3,
			// The first two finish; the third is still playing when the owner cuts in.
			truncateAssistant: undefined,
			onEmitted: (transport) => speech(transport, 6),
		});
		h.transport.manualFrom = 2;

		utterance(h.transport);
		await h.session.settle();

		expect(h.transport.stopped).toBe(1);
		expect(h.transport.plays).toHaveLength(3);

		// The third clause was never heard, so as far as every later turn is
		// concerned the companion never said it.
		const stored = messagesForDay(day).find((m) => m.id === row.id);
		expect(stored?.content).toBe("First clause. Second clause.");
	});

	it("drops the reply entirely when not one clause was heard", async () => {
		const h = harness({
			transcripts: ["tell me about the plan for tomorrow"],
			clauses: ["Only clause."],
			messageId: 4242,
			bargeInFrames: 3,
			onEmitted: (transport) => speech(transport, 6),
		});
		h.transport.manualFrom = 0;

		utterance(h.transport);
		await h.session.settle();

		expect(h.truncations).toEqual([{ id: 4242, heard: "" }]);
	});

	it("needs sustained speech, not one hot frame", async () => {
		const h = harness({
			transcripts: ["tell me about the plan for tomorrow"],
			clauses: ["Only clause."],
			messageId: 7,
			bargeInFrames: 8,
			onEmitted: (transport) => speech(transport, 3),
		});
		h.transport.manualFrom = 0;

		utterance(h.transport);
		await until(() => h.session.state === "speaking");
		await tick(100);

		// Still speaking: three frames of noise are not an interruption.
		expect(h.transport.stopped).toBe(0);
		expect(h.session.state).toBe("speaking");

		h.transport.resolvePending("played");
		await h.session.settle();
		expect(h.truncations).toEqual([]);
	});

	it("does not interrupt playback when barge-in is off", async () => {
		const h = harness({
			transcripts: ["tell me about the plan for tomorrow"],
			clauses: ["First clause. ", "Second clause."],
			messageId: 9,
			bargeIn: false,
			onEmitted: (transport) => speech(transport, 20),
		});
		h.transport.manualFrom = 0;

		utterance(h.transport);
		await until(() => h.session.state === "speaking");
		await tick(200);

		// Twenty frames of the owner talking over the reply, and playback is
		// still running: CALL_BARGE_IN=false means what it says.
		expect(h.transport.stopped).toBe(0);
		expect(h.session.state).toBe("speaking");
		expect(h.transport.plays).toHaveLength(2);

		h.transport.resolvePending("played");
		await h.session.settle();
		expect(h.truncations).toEqual([]);
	});
});

describe("a transport that misbehaves", () => {
	it("keeps the session alive when play() throws", async () => {
		const h = harness({
			transcripts: [
				"tell me about the plan for tomorrow",
				"and what about the day after",
			],
			clauses: ["Only clause."],
			messageId: 11,
			bargeInFrames: 3,
		});
		h.transport.throwOnPlay = true;

		utterance(h.transport);
		await h.session.settle();

		expect(h.turns).toHaveLength(1);
		expect(h.session.state).toBe("listening");
		// Nothing was heard, so nothing is claimed in history.
		expect(h.truncations).toEqual([{ id: 11, heard: "" }]);

		// And the next turn still runs.
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toHaveLength(2);
	});

	it("stops cleanly and closes the transport", async () => {
		const h = harness({ transcripts: ["what is the plan for tomorrow?"] });
		utterance(h.transport);
		await h.session.settle();

		await h.session.stop();
		expect(h.transport.closed).toBe(1);
		expect(h.transport.listener).toBeNull();
		expect(h.session.state).toBe("idle");

		// Audio after stop() is ignored rather than throwing somewhere odd.
		utterance(h.transport);
		await h.session.settle();
		expect(h.turns).toHaveLength(1);
	});

	it("hanging up mid-sentence truncates like any other interruption", async () => {
		const h = harness({
			transcripts: ["tell me about the plan for tomorrow"],
			clauses: ["First clause. ", "Second clause."],
			messageId: 13,
		});
		h.transport.manualFrom = 1; // the second clause is still playing

		utterance(h.transport);
		await until(() => h.session.state === "speaking");
		await tick(50);

		await h.session.stop();
		expect(h.truncations).toEqual([{ id: 13, heard: "First clause." }]);
		expect(h.transport.closed).toBe(1);
	});
});
