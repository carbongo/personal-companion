import { describe, expect, it } from "bun:test";

import {
	CallAudioResampler,
	Decimator48to16,
	downmixToMono,
	FrameAccumulator,
} from "#/companion-core/call/resample.ts";

/** A mono sine, in Int16 units, at `rate` samples per second. */
function sine(
	freqHz: number,
	rate: number,
	samples: number,
	amplitude = 8000,
): Int16Array {
	const out = new Int16Array(samples);
	for (let i = 0; i < samples; i++)
		out[i] = Math.round(
			amplitude * Math.sin((2 * Math.PI * freqHz * i) / rate),
		);
	return out;
}

/** Frequency estimate from sign changes; good enough for a clean tone. */
function estimateHz(samples: Int16Array, rate: number): number {
	let crossings = 0;
	for (let i = 1; i < samples.length; i++)
		if ((samples[i] ?? 0) >= 0 !== (samples[i - 1] ?? 0) >= 0) crossings++;
	return (crossings / 2 / samples.length) * rate;
}

function rms(samples: Int16Array): number {
	let acc = 0;
	for (const s of samples) acc += s * s;
	return Math.sqrt(acc / samples.length);
}

describe("downmixToMono", () => {
	it("averages the channels", () => {
		const stereo = Int16Array.from([100, 200, -100, 100, 0, 0]);
		expect(Array.from(downmixToMono(stereo, 2))).toEqual([150, 0, 0]);
	});

	it("passes mono through untouched", () => {
		const mono = Int16Array.from([1, 2, 3]);
		expect(downmixToMono(mono, 1)).toBe(mono);
	});
});

describe("Decimator48to16", () => {
	it("keeps an in-band tone at its own frequency", () => {
		const input = sine(1000, 48_000, 48_000);
		const out = new Decimator48to16().process(input);

		expect(out.length).toBe(16_000);
		// Skip the filter's warm-up before measuring.
		expect(estimateHz(out.subarray(200), 16_000)).toBeCloseTo(1000, -1);
		expect(rms(out.subarray(200))).toBeGreaterThan(0.9 * rms(input));
	});

	it("rejects an out-of-band tone instead of aliasing it down", () => {
		const input = sine(10_000, 48_000, 48_000);
		const out = new Decimator48to16().process(input).subarray(200);
		// Naive 3:1 decimation would fold 10 kHz onto 6 kHz at full amplitude.
		expect(rms(out)).toBeLessThan(0.02 * rms(input));
	});

	it("is continuous across chunk boundaries", () => {
		const input = sine(700, 48_000, 9_000);
		const oneShot = new Decimator48to16().process(input);

		const streamed = new Decimator48to16();
		const parts: Int16Array[] = [];
		// Deliberately ragged chunks, the way packets actually arrive.
		for (let i = 0; i < input.length; ) {
			const take = Math.min(((i % 7) + 1) * 91, input.length - i);
			parts.push(streamed.process(input.subarray(i, i + take)));
			i += take;
		}
		const joined = parts.flatMap((p) => Array.from(p));

		expect(joined.length).toBe(oneShot.length);
		expect(joined).toEqual(Array.from(oneShot));
	});
});

describe("CallAudioResampler", () => {
	it("turns 48 kHz stereo into 16 kHz mono", () => {
		const mono = sine(440, 48_000, 4_800);
		const stereo = new Int16Array(mono.length * 2);
		for (let i = 0; i < mono.length; i++) {
			stereo[i * 2] = mono[i] ?? 0;
			stereo[i * 2 + 1] = mono[i] ?? 0;
		}

		const frame = new CallAudioResampler().process(stereo);
		expect(frame.sampleRate).toBe(16_000);
		expect(frame.samples.length).toBe(1_600);
		expect(estimateHz(frame.samples.subarray(200), 16_000)).toBeCloseTo(
			440,
			-2,
		);
	});
});

describe("FrameAccumulator", () => {
	it("reframes a chunked stream into exact 512-sample frames", () => {
		const acc = new FrameAccumulator();
		const total = 512 * 4 + 64;
		const source = new Int16Array(total);
		for (let i = 0; i < total; i++) source[i] = (i % 200) - 100;

		const got: number[] = [];
		let emitted = 0;
		for (let i = 0; i < total; ) {
			const take = Math.min(((i % 5) + 1) * 137, total - i);
			for (const frame of acc.push(source.subarray(i, i + take))) {
				expect(frame.samples.length).toBe(512);
				expect(frame.sampleRate).toBe(16_000);
				got.push(...frame.samples);
				emitted++;
			}
			i += take;
		}

		expect(emitted).toBe(4);
		expect(acc.pending).toBe(64);
		expect(got).toEqual(Array.from(source.subarray(0, 512 * 4)));
	});

	it("keeps a short input as a tail rather than emitting a partial frame", () => {
		const acc = new FrameAccumulator();
		expect(acc.push(new Int16Array(10))).toHaveLength(0);
		expect(acc.pending).toBe(10);
		expect(acc.push(new Int16Array(502))).toHaveLength(1);
		expect(acc.pending).toBe(0);
	});

	it("drains the tail zero-padded, once", () => {
		const acc = new FrameAccumulator();
		acc.push(Int16Array.from([1, 2, 3]));
		const drained = acc.drain();
		expect(drained?.samples.length).toBe(512);
		expect(Array.from(drained?.samples.subarray(0, 4) ?? [])).toEqual([
			1, 2, 3, 0,
		]);
		expect(acc.drain()).toBeNull();
	});
});
