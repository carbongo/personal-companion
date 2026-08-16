/**
 * The call session: the loop that turns a live audio stream into turns, and
 * turns back into speech.
 *
 *   owner audio → resample/reframe → VAD → utterance framing → STT
 *   → hallucination gate → backchannel filter → endpointer
 *   → engine.respondClauses → TTS per clause → transport.play
 *
 * Everything it knows about the outside world is `CallTransport`. There is no
 * Discord in this file, and there must not be: the seam is what makes a later
 * SIP or browser transport an adapter rather than a rewrite (see
 * docs/decisions/discord-voice-calls.md).
 *
 * Two concurrency rules hold the design together:
 *
 *   1. The frame path never waits on a turn. Detection keeps running while the
 *      companion is thinking and while it is speaking — otherwise barge-in
 *      could only be noticed after the reply it was meant to interrupt.
 *   2. Turns are serialized. One transcript is handled at a time, in the order
 *      the utterances closed, so history is written in the order it happened.
 *
 * Barge-in is the part with teeth. When the owner talks over the companion we
 * stop playback, abandon the clauses that were never synthesized, and then
 * rewrite the stored reply down to the clauses the transport confirmed as
 * "played". A clause that came back "cut" was never heard, so it never happened.
 */
import { transcribe as sttTranscribe } from "#/channels/stt.ts";
import { synthesize as ttsSynthesize } from "#/channels/tts.ts";
import { isBackchannelOnly } from "#/companion-core/call/backchannel.ts";
import {
	createHeuristicEndpointer,
	type Endpointer,
} from "#/companion-core/call/endpointing.ts";
import {
	type FramingOptions,
	type UtteranceEvent,
	UtteranceFramer,
} from "#/companion-core/call/framing.ts";
import { isLikelyHallucination } from "#/companion-core/call/hallucination-gate.ts";
import {
	CallAudioResampler,
	ENGINE_SAMPLE_RATE,
	FrameAccumulator,
	VAD_FRAME_SIZE,
} from "#/companion-core/call/resample.ts";
import type {
	AudioFormat,
	CallTransport,
	PcmFrame,
	PlaybackResult,
	VoiceActivityDetector,
} from "#/companion-core/call/types.ts";
import { createVad, EnergyVad } from "#/companion-core/call/vad.ts";
import type { EngineReply, Turn } from "#/companion-core/engine.ts";
import { respondClauses } from "#/companion-core/engine.ts";
import {
	deleteMessage,
	setMessageContent,
} from "#/companion-core/memory/store.ts";
import { sanitizeForSpeech } from "#/companion-core/speak.ts";
import { config } from "#/config/index.ts";

/** How long one detector frame lasts, in milliseconds (512 @ 16 kHz = 32 ms). */
export const FRAME_MS = (VAD_FRAME_SIZE / ENGINE_SAMPLE_RATE) * 1000;

/** Where the session is in the loop. Exposed for transports that show presence. */
export type CallState = "idle" | "listening" | "thinking" | "speaking";

/** Cancels a scheduled callback. */
type Cancel = () => void;

/** The one framing event a session acts on. */
type UtteranceEnd = Extract<UtteranceEvent, { type: "utterance-end" }>;

/**
 * The boundaries the session talks to. All optional and all defaulted to the
 * real thing — they exist so the loop can be driven with synthetic audio and a
 * stubbed model in tests, which is the only honest way to test a state machine
 * whose inputs are a microphone and an LLM.
 */
export interface CallSessionDeps {
	transcribe?: (bytes: Uint8Array, filename: string) => Promise<string>;
	synthesize?: (text: string) => Promise<Uint8Array>;
	respond?: (
		turn: Turn,
		emit: (clause: string) => void | Promise<void>,
	) => Promise<EngineReply>;
	/** Rewrite the assistant row to what was actually heard (empty = nothing was). */
	truncateAssistant?: (id: number, heard: string) => void;
	/** Deferred callback, returning a canceller. Injected so tests own the clock. */
	schedule?: (fn: () => void, ms: number) => Cancel;
	log?: (message: string) => void;
}

export interface CallSessionOptions extends CallSessionDeps {
	/** Detector to run over each frame; defaults to the dependency-free one. */
	vad?: VoiceActivityDetector;
	/** Endpointer deciding when the owner has finished a thought. */
	endpointer?: Endpointer;
	/** Utterance framing overrides; the rest comes from `CALL_*`. */
	framing?: FramingOptions;
	/** Whether the owner can interrupt playback. Defaults to `CALL_BARGE_IN`. */
	bargeIn?: boolean;
	/** Consecutive speech frames required to interrupt. See the note below. */
	bargeInFrames?: number;
	/** Speech probability a frame needs before it counts toward an interruption. */
	bargeInThreshold?: number;
	/** Override the container declared to the transport; sniffed when absent. */
	playbackFormat?: AudioFormat;
}

const defaultTruncate = (id: number, heard: string): void => {
	if (heard) setMessageContent(id, heard);
	else deleteMessage(id);
};

const defaultSchedule = (fn: () => void, ms: number): Cancel => {
	const handle = setTimeout(fn, ms);
	return () => clearTimeout(handle);
};

/**
 * What container the TTS backend handed back, so the transport knows what it is
 * being asked to decode. Anything unrecognised is declared "wav": transports
 * hand unknown bytes to a decoder that probes them anyway, and claiming "pcm16"
 * for a container would be actively wrong.
 */
export function detectAudioFormat(bytes: Uint8Array): AudioFormat {
	// "OggS" — Opus and Vorbis both ride in an Ogg container.
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x4f &&
		bytes[1] === 0x67 &&
		bytes[2] === 0x67 &&
		bytes[3] === 0x53
	)
		return "opus";
	return "wav";
}

/**
 * Wrap raw mono PCM in a 44-byte WAV header. STT backends take a file, and the
 * framer hands us bare samples; this is the whole distance between the two.
 */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
	const bytesPerSample = 2;
	const dataBytes = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string): void => {
		for (let i = 0; i < text.length; i++)
			view.setUint8(offset + i, text.charCodeAt(i));
	};

	ascii(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true); // PCM header length
	view.setUint16(20, 1, true); // PCM, uncompressed
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
	view.setUint16(32, bytesPerSample, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, "data");
	view.setUint32(40, dataBytes, true);
	for (let i = 0; i < samples.length; i++)
		view.setInt16(44 + i * bytesPerSample, samples[i] ?? 0, true);

	return new Uint8Array(buffer);
}

export class CallSession {
	private readonly accumulator = new FrameAccumulator();
	private readonly framer: UtteranceFramer;
	private readonly vad: VoiceActivityDetector;
	private readonly endpointer: Endpointer;
	private readonly deps: Required<CallSessionDeps>;
	private readonly bargeInEnabled: boolean;
	private readonly bargeInFrames: number;
	private readonly bargeInThreshold: number;
	private readonly playbackFormat: AudioFormat | undefined;
	/** Trailing quiet the framer already waited through before closing an utterance. */
	private readonly trailingSilenceMs: number;

	private resampler: CallAudioResampler | null = null;
	private unsubscribe: (() => void) | null = null;
	private frameChain: Promise<void> = Promise.resolve();
	private turnChain: Promise<void> = Promise.resolve();
	private phase: CallState = "idle";
	private hotFrames = 0;
	private barged = false;
	private closed = false;
	private pending: { text: string } | null = null;
	private cancelPending: Cancel | null = null;

	constructor(
		private readonly transport: CallTransport,
		options: CallSessionOptions = {},
	) {
		const call = config.call;
		const framing: FramingOptions = {
			threshold: call.vadThreshold,
			// The framer's silence window *is* the endpointing patience: by the time
			// an utterance closes, that much quiet has already passed, which is what
			// the endpointer is then told about.
			silenceFrames: Math.max(1, Math.round(call.silenceMs / FRAME_MS)),
			minSpeechMs: call.minSpeechMs,
			maxUtteranceMs: call.maxUtteranceMs,
			...options.framing,
		};
		this.framer = new UtteranceFramer(framing);
		this.trailingSilenceMs = (framing.silenceFrames ?? 1) * FRAME_MS;
		this.vad = options.vad ?? new EnergyVad();
		this.endpointer = options.endpointer ?? createHeuristicEndpointer();

		this.bargeInEnabled = options.bargeIn ?? call.bargeIn;
		this.bargeInThreshold =
			options.bargeInThreshold ?? framing.threshold ?? call.vadThreshold;
		// Sustained speech, not one hot frame: a single loud frame is a door, a
		// keyboard, or the companion's own voice leaking back, and cutting the
		// reply for it is worse than missing an interruption. The bar is the same
		// minimum duration that makes an utterance real in the first place, so the
		// sensitivity is tuned by CALL_MIN_SPEECH_MS / CALL_VAD_THRESHOLD.
		this.bargeInFrames =
			options.bargeInFrames ??
			Math.max(
				2,
				Math.ceil((framing.minSpeechMs ?? call.minSpeechMs) / FRAME_MS),
			);

		this.playbackFormat = options.playbackFormat;
		this.deps = {
			transcribe: options.transcribe ?? sttTranscribe,
			synthesize: options.synthesize ?? ttsSynthesize,
			respond: options.respond ?? respondClauses,
			truncateAssistant: options.truncateAssistant ?? defaultTruncate,
			schedule: options.schedule ?? defaultSchedule,
			log: options.log ?? ((message) => console.log(`[call] ${message}`)),
		};
	}

	/** Where the loop is right now. */
	get state(): CallState {
		return this.phase;
	}

	/** Subscribe to the transport and start listening. Idempotent. */
	start(): void {
		if (this.unsubscribe || this.closed) return;
		this.phase = "listening";
		this.unsubscribe = this.transport.onOwnerAudio((frame) =>
			this.onAudio(frame),
		);
	}

	/**
	 * Stop listening and leave the call. Whatever is mid-flight is allowed to
	 * settle first, so a turn that was already speaking still gets its history
	 * corrected before the transport goes away.
	 */
	async stop(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.clearPending();
		// Hanging up mid-sentence is an interruption like any other: stopping
		// playback resolves the clauses in flight as "cut", which both ends the
		// wait below and leaves history saying only what the owner heard.
		try {
			this.transport.stopPlayback();
		} catch (err) {
			this.warn("stopPlayback", err);
		}
		this.unsubscribe?.();
		this.unsubscribe = null;
		await this.settle();
		this.phase = "idle";
		try {
			await this.transport.close();
		} catch (err) {
			this.warn("close", err);
		}
	}

	/**
	 * Resolve once every frame and turn queued so far has been handled. A frame
	 * can queue a turn, and a turn can queue nothing, so two rounds is enough to
	 * drain both chains.
	 */
	async settle(): Promise<void> {
		for (let i = 0; i < 2; i++) {
			await this.frameChain.catch(() => {});
			await this.turnChain.catch(() => {});
		}
	}

	// --- the frame path ------------------------------------------------------

	private onAudio(frame: PcmFrame): void {
		if (this.closed) return;
		for (const f of this.reframe(frame)) {
			// One frame at a time, in order: a detector may be async (Silero runs an
			// ONNX session) and it carries state from frame to frame, so overlapping
			// calls would scramble its idea of where the speech is.
			this.frameChain = this.frameChain
				.then(() => this.onEngineFrame(f))
				.catch((err) => this.warn("frame", err));
		}
	}

	/** Get whatever arrived into exact 512-sample 16 kHz frames. */
	private reframe(frame: PcmFrame): PcmFrame[] {
		let samples = frame.samples;
		if (frame.sampleRate !== ENGINE_SAMPLE_RATE) {
			// The transport contract promises engine-rate audio. A transport that
			// hands over its native 48 kHz instead is resampled here rather than
			// left to feed the detector aliasing that sounds exactly like speech.
			this.resampler ??= new CallAudioResampler(1, frame.sampleRate);
			samples = this.resampler.process(samples).samples;
		}
		return this.accumulator.push(samples);
	}

	private async onEngineFrame(frame: PcmFrame): Promise<void> {
		const probability = await this.vad.process(frame);
		this.trackBargeIn(probability);
		for (const event of this.framer.push(frame, probability)) {
			// An utterance too short to be speech is dropped by the framer; the
			// barge-in it may already have triggered stands, because playback that
			// has stopped cannot be un-stopped.
			if (event.type === "utterance-end") this.queueUtterance(event);
		}
	}

	private trackBargeIn(probability: number): void {
		if (!this.bargeInEnabled) return;
		this.hotFrames =
			probability >= this.bargeInThreshold ? this.hotFrames + 1 : 0;
		if (this.phase !== "speaking") return;
		if (this.hotFrames < this.bargeInFrames) return;
		this.interrupt();
	}

	private interrupt(): void {
		if (this.barged) return;
		this.barged = true;
		this.deps.log("barge-in: the owner is speaking, stopping playback");
		try {
			// In-flight play() calls resolve "cut" — which is how the turn about to
			// finish learns what the owner never heard.
			this.transport.stopPlayback();
		} catch (err) {
			this.warn("stopPlayback", err);
		}
	}

	// --- the turn path -------------------------------------------------------

	private queueUtterance(event: UtteranceEnd): void {
		// Deliberately not awaited by the frame path: transcription and generation
		// take seconds, and audio has to keep flowing through the detector while
		// they do or an interruption would arrive after the reply it interrupts.
		this.turnChain = this.turnChain
			.then(() => this.handleUtterance(event))
			.catch((err) => this.warn("turn", err));
	}

	private async handleUtterance(event: UtteranceEnd): Promise<void> {
		if (this.closed) return;

		const text = (await this.transcribe(event)).trim();
		if (!text) return;

		// The framer reports the whole buffered utterance, trailing silence
		// included, so the gate's words-per-second sanity check runs a little
		// generous — which is the right direction to be wrong in: dropping real
		// speech reads as the companion ignoring the owner.
		if (isLikelyHallucination({ text, speechDurationMs: event.durationMs })) {
			this.deps.log(`dropped a likely STT hallucination: "${text}"`);
			return;
		}
		if (isBackchannelOnly(text)) {
			this.deps.log(`dropped a backchannel: "${text}"`);
			return;
		}

		this.clearPending();
		const transcript = this.pending
			? `${this.pending.text} ${text}`.trim()
			: text;
		this.pending = null;

		const decision = this.endpointer.decide({
			transcript,
			silenceMs: this.trailingSilenceMs,
		});
		if (!decision.commit) {
			// Mid-thought — a trailing "um" wants the rest of the sentence, so the
			// next utterance appends to this one instead of starting a turn. The
			// timer is the backstop for an owner who simply stopped talking.
			this.deps.log(`holding the turn open (${decision.reason})`);
			this.pending = { text: transcript };
			const waitMs = Math.max(0, decision.waitMs - this.trailingSilenceMs);
			this.cancelPending = this.deps.schedule(
				() => this.commitPending(),
				waitMs,
			);
			return;
		}
		await this.runTurn(transcript);
	}

	private clearPending(): void {
		this.cancelPending?.();
		this.cancelPending = null;
	}

	/**
	 * The patience the endpointer asked for has passed with nothing more said, so
	 * the held text is the turn. No second opinion is sought: at this silence
	 * every branch of the endpointer commits, and asking again could only start
	 * another wait.
	 */
	private commitPending(): void {
		const held = this.pending;
		this.pending = null;
		this.cancelPending = null;
		if (!held || this.closed) return;
		this.turnChain = this.turnChain
			.then(() => this.runTurn(held.text))
			.catch((err) => this.warn("turn", err));
	}

	private async runTurn(text: string): Promise<void> {
		if (this.closed) return;
		this.phase = "thinking";
		this.barged = false;
		// The frames that ended the owner's own utterance must not read as an
		// interruption of the reply they asked for.
		this.hotFrames = 0;

		const queued: { text: string; result: Promise<PlaybackResult> }[] = [];
		const emit = async (clause: string): Promise<void> => {
			if (this.barged || this.closed) return; // abandon what is left unsaid
			const audio = await this.speak(clause);
			if (!audio) return;
			// Barge-in can land while the synthesizer is working; the clause it was
			// making is then never queued, so it never reaches history either.
			if (this.barged || this.closed) return;
			this.phase = "speaking";
			queued.push({ text: clause, result: this.play(audio) });
		};

		let reply: EngineReply;
		try {
			reply = await this.deps.respond({ text, kind: "voice" }, emit);
		} catch (err) {
			this.warn("engine", err);
			this.phase = "listening";
			return;
		}

		const results = await Promise.all(queued.map((q) => q.result));
		this.phase = "listening";

		const heard = queued
			.filter((_, i) => results[i] === "played")
			.map((q) => q.text)
			.join("")
			.trim();
		const cut = this.barged || results.some((r) => r !== "played");
		if (!cut || reply.messageId === undefined) return;

		// The reply in the log is now longer than the reply the owner received.
		// Cut it back, or drop it entirely if not one word of it landed.
		try {
			this.deps.truncateAssistant(reply.messageId, heard);
			this.deps.log(
				heard
					? "truncated the reply in history to what was spoken"
					: "dropped an interrupted reply nothing was heard of",
			);
		} catch (err) {
			this.warn("history", err);
		}
	}

	// --- boundaries ----------------------------------------------------------

	private async transcribe(event: UtteranceEnd): Promise<string> {
		try {
			return await this.deps.transcribe(
				encodeWav(event.samples, event.sampleRate),
				"call.wav",
			);
		} catch (err) {
			// A transcription that fails costs the owner one turn, not the call.
			this.warn("stt", err);
			return "";
		}
	}

	private async speak(clause: string): Promise<Uint8Array | undefined> {
		try {
			const audio = await this.deps.synthesize(sanitizeForSpeech(clause));
			return audio.length ? audio : undefined;
		} catch (err) {
			this.warn("tts", err);
			return undefined;
		}
	}

	/**
	 * Queue one clause for playback. A transport that throws or rejects is
	 * treated as a clause the owner never heard — which is the truthful reading,
	 * and keeps history honest instead of taking the session down.
	 */
	private play(audio: Uint8Array): Promise<PlaybackResult> {
		const format = this.playbackFormat ?? detectAudioFormat(audio);
		try {
			return this.transport.play(audio, format).catch((err) => {
				this.warn("play", err);
				return "cut" as const;
			});
		} catch (err) {
			this.warn("play", err);
			return Promise.resolve("cut" as const);
		}
	}

	private warn(where: string, err: unknown): void {
		const detail = err instanceof Error ? err.message : String(err);
		this.deps.log(`${where} failed: ${detail}`);
	}
}

/**
 * Build a session with the detector the configuration asks for, and start
 * listening. The VAD is created here rather than in the constructor because
 * building it may download a model — a call must not block on that inside a
 * constructor, and a session built by hand should still work with no awaiting.
 */
export async function startCallSession(
	transport: CallTransport,
	options: CallSessionOptions = {},
): Promise<CallSession> {
	const vad =
		options.vad ??
		(await createVad({
			provider: config.call.vadProvider,
			threshold: config.call.vadThreshold,
			dataDir: config.app.dataDir,
		}));
	const session = new CallSession(transport, { ...options, vad });
	session.start();
	return session;
}
