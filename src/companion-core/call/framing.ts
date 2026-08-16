/**
 * From per-frame speech probabilities to utterances.
 *
 * A detector answers one frame at a time and it is occasionally wrong, so
 * reacting to a single frame either chops words in half or starts an utterance
 * on a cough. This is the small state machine that sits in between:
 *
 *   - hysteresis — N consecutive speech frames open an utterance, M consecutive
 *     silent ones close it, and the two counts are separate because the cost of
 *     being wrong differs in each direction;
 *   - a pre-roll — the frames that convinced us speech started are kept, so the
 *     opening consonant survives the decision to open;
 *   - a minimum duration — anything shorter is a door click, not a sentence;
 *   - a maximum duration — a mic stuck open must not buffer the whole call.
 *
 * It holds audio but never looks at it, which is what makes it testable with a
 * bare sequence of probabilities.
 */

import { ENGINE_SAMPLE_RATE } from "#/companion-core/call/resample.ts";
import type { PcmFrame } from "#/companion-core/call/types.ts";

export interface FramingOptions {
	/** Speech probability at or above which a frame counts as speech. */
	threshold?: number;
	/** Consecutive speech frames needed to open an utterance. */
	speechFrames?: number;
	/** Consecutive silent frames needed to close one. */
	silenceFrames?: number;
	/** Frames kept before the opening decision so the onset is not clipped. */
	prerollFrames?: number;
	/** Utterances with less actual speech than this are dropped as noise. */
	minSpeechMs?: number;
	/** Hard ceiling; the utterance is closed and handed on regardless. */
	maxUtteranceMs?: number;
}

const DEFAULTS: Required<FramingOptions> = {
	threshold: 0.5,
	speechFrames: 3, // ~96ms at 512 samples / 16 kHz
	silenceFrames: 15, // ~480ms of quiet before we believe the turn ended
	prerollFrames: 5,
	minSpeechMs: 250,
	maxUtteranceMs: 30_000,
};

export type UtteranceEvent =
	| { type: "utterance-start" }
	/** A complete utterance: the buffered audio, and why it ended. */
	| {
			type: "utterance-end";
			samples: Int16Array;
			sampleRate: number;
			durationMs: number;
			reason: "silence" | "max-duration";
	  }
	/** Opened, but too short to be speech — reported so callers can undo a barge-in. */
	| { type: "utterance-discarded"; durationMs: number };

/** Frames a stream of (frame, probability) pairs into utterances. */
export class UtteranceFramer {
	private readonly opts: Required<FramingOptions>;
	private speaking = false;
	private speechRun = 0;
	private silenceRun = 0;
	private buffer: Int16Array[] = [];
	private preroll: Int16Array[] = [];
	private bufferedSamples = 0;
	private speechSamples = 0;
	private sampleRate = ENGINE_SAMPLE_RATE;

	constructor(options: FramingOptions = {}) {
		this.opts = { ...DEFAULTS, ...options };
	}

	reset(): void {
		this.speaking = false;
		this.speechRun = 0;
		this.silenceRun = 0;
		this.buffer = [];
		this.preroll = [];
		this.bufferedSamples = 0;
		this.speechSamples = 0;
	}

	/** True between utterance-start and the matching end. */
	get isSpeaking(): boolean {
		return this.speaking;
	}

	/** Duration of what is currently buffered, in milliseconds. */
	get bufferedMs(): number {
		return (this.bufferedSamples / this.sampleRate) * 1000;
	}

	/** Feed one frame and its speech probability; get back whatever it decided. */
	push(frame: PcmFrame, probability: number): UtteranceEvent[] {
		this.sampleRate = frame.sampleRate;
		const isSpeech = probability >= this.opts.threshold;
		const events: UtteranceEvent[] = [];

		if (!this.speaking) {
			this.rememberPreroll(frame.samples);
			this.speechRun = isSpeech ? this.speechRun + 1 : 0;
			if (this.speechRun >= this.opts.speechFrames) {
				this.open();
				events.push({ type: "utterance-start" });
			}
			return events;
		}

		this.buffer.push(frame.samples);
		this.bufferedSamples += frame.samples.length;
		if (isSpeech) this.speechSamples += frame.samples.length;
		this.silenceRun = isSpeech ? 0 : this.silenceRun + 1;

		if (this.silenceRun >= this.opts.silenceFrames) {
			events.push(this.close("silence"));
		} else if (this.bufferedMs >= this.opts.maxUtteranceMs) {
			events.push(this.close("max-duration"));
		}
		return events;
	}

	/**
	 * Close whatever is open — the call ended, or the transport went away. The
	 * minimum-duration rule still applies, so a half-word is not sent on.
	 */
	flush(): UtteranceEvent[] {
		if (!this.speaking) return [];
		return [this.close("silence")];
	}

	private rememberPreroll(samples: Int16Array): void {
		this.preroll.push(samples);
		if (this.preroll.length > this.opts.prerollFrames) this.preroll.shift();
	}

	private open(): void {
		this.speaking = true;
		this.silenceRun = 0;
		this.speechRun = 0;
		this.buffer = this.preroll.slice();
		this.bufferedSamples = this.buffer.reduce((n, f) => n + f.length, 0);
		// The frames that convinced us are speech; everything earlier in the
		// pre-roll is context, not evidence.
		this.speechSamples = this.preroll
			.slice(-this.opts.speechFrames)
			.reduce((n, f) => n + f.length, 0);
		this.preroll = [];
	}

	private close(reason: "silence" | "max-duration"): UtteranceEvent {
		const durationMs = this.bufferedMs;
		// Judged on speech, not on wall clock: a click followed by the silence
		// that closes the utterance is long but almost entirely quiet.
		const speechMs = (this.speechSamples / this.sampleRate) * 1000;
		const samples = concat(this.buffer, this.bufferedSamples);
		const sampleRate = this.sampleRate;
		this.reset();

		if (speechMs < this.opts.minSpeechMs)
			return { type: "utterance-discarded", durationMs };
		return { type: "utterance-end", samples, sampleRate, durationMs, reason };
	}
}

function concat(chunks: Int16Array[], total: number): Int16Array {
	const out = new Int16Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}
