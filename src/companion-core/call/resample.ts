/**
 * Getting call audio into the engine's currency: 16 kHz mono PCM.
 *
 * A Discord voice packet decodes to 48 kHz stereo interleaved Int16, and the
 * detectors downstream want 16 kHz mono in exact 512-sample frames. Two things
 * therefore happen here, and both are less trivial than they look:
 *
 *   1. Rate conversion. Dropping two of every three samples is the obvious
 *      decimation and it is wrong: everything above 8 kHz folds back into the
 *      band as noise, and the VAD hears that fold as speech. So we low-pass
 *      first, with a windowed-sinc FIR whose history carries across chunks —
 *      a call is a stream, not a file, and a filter that resets every packet
 *      clicks at every seam.
 *
 *   2. Reframing. Network audio arrives in whatever sizes the transport felt
 *      like; Silero wants exactly 512 samples. `FrameAccumulator` absorbs the
 *      difference and keeps the leftover tail for the next chunk.
 */
import type { PcmFrame } from "#/companion-core/call/types.ts";

/** Frames the VAD layer works in: 512 samples @ 16 kHz, i.e. 32 ms. */
export const VAD_FRAME_SIZE = 512;
export const ENGINE_SAMPLE_RATE = 16_000;

const DISCORD_SAMPLE_RATE = 48_000;
const DECIMATION = DISCORD_SAMPLE_RATE / ENGINE_SAMPLE_RATE; // 3

// 63 taps puts the transition band roughly between 6.8 and 8 kHz, so the new
// Nyquist is already deep in the stopband. Longer would be sharper; this is
// about 1M multiply-adds a second, which a call can afford and a laptop
// will not notice.
const FIR_TAPS = 63;
const FIR_CUTOFF_HZ = 6_800;

/**
 * A windowed-sinc low-pass. Hamming rather than rectangular: the ripple of a
 * truncated sinc is loud enough to matter at the amplitudes speech lives at.
 */
export function designLowPass(
	taps: number,
	cutoffHz: number,
	sampleRate: number,
): Float32Array {
	const h = new Float32Array(taps);
	const mid = (taps - 1) / 2;
	const fc = cutoffHz / sampleRate; // normalized, cycles per sample
	let sum = 0;
	for (let n = 0; n < taps; n++) {
		const x = n - mid;
		const sinc =
			x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
		const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1));
		const tap = sinc * window;
		h[n] = tap;
		sum += tap;
	}
	// Normalize to unity gain at DC so a steady signal keeps its level.
	for (let n = 0; n < taps; n++) h[n] = (h[n] ?? 0) / sum;
	return h;
}

const clampInt16 = (v: number): number =>
	v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v);

/**
 * Average interleaved channels down to mono. Averaging rather than picking the
 * left channel: a transport that pans the owner's mic would otherwise go quiet.
 */
export function downmixToMono(
	interleaved: Int16Array,
	channels: number,
): Int16Array {
	if (channels <= 1) return interleaved;
	const frames = Math.floor(interleaved.length / channels);
	const out = new Int16Array(frames);
	for (let i = 0; i < frames; i++) {
		let acc = 0;
		for (let c = 0; c < channels; c++)
			acc += interleaved[i * channels + c] ?? 0;
		out[i] = clampInt16(acc / channels);
	}
	return out;
}

/**
 * A streaming 48 kHz → 16 kHz decimator. Stateful on purpose: both the filter
 * history and the decimation phase have to survive the gap between packets.
 */
export class Decimator48to16 {
	private readonly taps: Float32Array;
	private history: Float32Array;
	private phase = 0;

	constructor(
		taps = FIR_TAPS,
		cutoffHz = FIR_CUTOFF_HZ,
		inputRate = DISCORD_SAMPLE_RATE,
	) {
		this.taps = designLowPass(taps, cutoffHz, inputRate);
		this.history = new Float32Array(taps - 1);
	}

	reset(): void {
		this.history = new Float32Array(this.taps.length - 1);
		this.phase = 0;
	}

	/** Filter and decimate one chunk of mono 48 kHz samples. */
	process(mono: Int16Array): Int16Array {
		const t = this.taps.length;
		const hist = this.history;
		// One contiguous buffer of [previous tail | this chunk] keeps the inner
		// loop branch-free, which is where all the time goes.
		const buf = new Float32Array(hist.length + mono.length);
		buf.set(hist, 0);
		for (let i = 0; i < mono.length; i++) buf[hist.length + i] = mono[i] ?? 0;

		const out: number[] = [];
		for (let i = 0; i < mono.length; i++) {
			if (this.phase === 0) {
				const c = hist.length + i;
				let acc = 0;
				for (let k = 0; k < t; k++)
					acc += (this.taps[k] ?? 0) * (buf[c - k] ?? 0);
				out.push(clampInt16(acc));
			}
			this.phase = (this.phase + 1) % DECIMATION;
		}

		this.history = buf.slice(buf.length - hist.length);
		return Int16Array.from(out);
	}
}

/**
 * The whole path from a decoded transport packet to engine-rate mono, holding
 * the filter state for one speaker.
 */
export class CallAudioResampler {
	private readonly decimator = new Decimator48to16();

	constructor(
		private readonly channels = 2,
		private readonly inputRate = DISCORD_SAMPLE_RATE,
	) {}

	reset(): void {
		this.decimator.reset();
	}

	/** Interleaved Int16 in, 16 kHz mono PcmFrame out (possibly empty). */
	process(interleaved: Int16Array): PcmFrame {
		const mono = downmixToMono(interleaved, this.channels);
		if (this.inputRate === ENGINE_SAMPLE_RATE)
			return { samples: mono, sampleRate: ENGINE_SAMPLE_RATE };
		return {
			samples: this.decimator.process(mono),
			sampleRate: ENGINE_SAMPLE_RATE,
		};
	}
}

/**
 * Turns an arbitrarily chunked stream into exact fixed-size frames, keeping the
 * remainder for next time. Nothing is dropped and nothing is invented — a frame
 * only comes out once every sample in it has arrived.
 */
export class FrameAccumulator {
	private buffer: Int16Array;
	private filled = 0;

	constructor(
		readonly frameSize = VAD_FRAME_SIZE,
		readonly sampleRate = ENGINE_SAMPLE_RATE,
	) {
		this.buffer = new Int16Array(frameSize);
	}

	/** How many samples are waiting for the rest of their frame. */
	get pending(): number {
		return this.filled;
	}

	reset(): void {
		this.filled = 0;
	}

	/** Feed samples; get back every complete frame they completed. */
	push(samples: Int16Array): PcmFrame[] {
		const frames: PcmFrame[] = [];
		let offset = 0;
		while (offset < samples.length) {
			const take = Math.min(
				this.frameSize - this.filled,
				samples.length - offset,
			);
			this.buffer.set(samples.subarray(offset, offset + take), this.filled);
			this.filled += take;
			offset += take;
			if (this.filled === this.frameSize) {
				frames.push({
					samples: this.buffer.slice(),
					sampleRate: this.sampleRate,
				});
				this.filled = 0;
			}
		}
		return frames;
	}

	/** Same, for callers already holding a PcmFrame. */
	pushFrame(frame: PcmFrame): PcmFrame[] {
		return this.push(frame.samples);
	}

	/**
	 * Emit the buffered tail zero-padded to a full frame, for the end of an
	 * utterance where waiting for more audio would just add latency.
	 */
	drain(): PcmFrame | null {
		if (this.filled === 0) return null;
		const out = new Int16Array(this.frameSize);
		out.set(this.buffer.subarray(0, this.filled));
		this.filled = 0;
		return { samples: out, sampleRate: this.sampleRate };
	}
}
