import { describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PcmFrame } from "#/companion-core/call/types.ts";
import {
	createSileroVad,
	createVad,
	EnergyVad,
	rms,
	SileroVad,
	sileroModelPath,
	zeroCrossingRate,
} from "#/companion-core/call/vad.ts";

const FRAME = 512;
const RATE = 16_000;

const frameOf = (samples: Int16Array): PcmFrame => ({
	samples,
	sampleRate: RATE,
});

function tone(freqHz: number, offset: number, amplitude = 8000): PcmFrame {
	const s = new Int16Array(FRAME);
	for (let i = 0; i < FRAME; i++)
		s[i] = Math.round(
			amplitude * Math.sin((2 * Math.PI * freqHz * (offset + i)) / RATE),
		);
	return frameOf(s);
}

function noise(seed: number, amplitude = 8000): PcmFrame {
	// A tiny deterministic LCG: white-ish, and the same on every machine.
	let x = seed;
	const s = new Int16Array(FRAME);
	for (let i = 0; i < FRAME; i++) {
		x = (x * 1103515245 + 12345) & 0x7fffffff;
		s[i] = Math.round((x / 0x3fffffff - 1) * amplitude);
	}
	return frameOf(s);
}

const silence = (): PcmFrame => frameOf(new Int16Array(FRAME));

describe("frame measures", () => {
	it("reads silence as zero energy and no crossings", () => {
		expect(rms(new Int16Array(FRAME))).toBe(0);
		expect(zeroCrossingRate(new Int16Array(FRAME))).toBe(0);
	});

	it("reads a sine's amplitude and its crossing rate", () => {
		const t = tone(400, 0).samples;
		expect(rms(t)).toBeCloseTo(8000 / Math.SQRT2, -2);
		expect(zeroCrossingRate(t)).toBeCloseTo((2 * 400) / RATE, 2);
	});
});

describe("EnergyVad", () => {
	it("reports silence as no speech", () => {
		const vad = new EnergyVad();
		for (let i = 0; i < 10; i++) expect(vad.process(silence())).toBe(0);
	});

	it("reports a voiced-looking tone as speech", () => {
		const vad = new EnergyVad();
		for (let i = 0; i < 10; i++) vad.process(silence());
		expect(vad.process(tone(300, 0))).toBeGreaterThan(0.8);
	});

	it("holds back on broadband noise via the zero-crossing check", () => {
		const vad = new EnergyVad();
		for (let i = 0; i < 10; i++) vad.process(silence());
		const p = vad.process(noise(7));
		expect(p).toBeGreaterThan(0);
		expect(p).toBeLessThan(0.5);
	});

	it("learns a constant hum into the noise floor", () => {
		const vad = new EnergyVad();
		let offset = 0;
		let last = 0;
		for (let i = 0; i < 200; i++) {
			last = vad.process(tone(120, offset));
			offset += FRAME;
		}
		expect(last).toBeLessThan(0.2);
	});

	it("forgets what it learned on reset", () => {
		const vad = new EnergyVad();
		let offset = 0;
		for (let i = 0; i < 200; i++, offset += FRAME)
			vad.process(tone(120, offset));
		vad.reset();
		expect(vad.process(tone(120, offset))).toBeGreaterThan(0.8);
	});
});

describe("createVad", () => {
	it("returns the energy detector when asked for it", async () => {
		expect((await createVad({ provider: "energy" })).name).toBe("energy");
	});

	it("falls back to energy rather than throwing when Silero cannot load", async () => {
		// A data dir under a regular file cannot be created, so this fails before
		// any network call — CI has neither the model nor a connection.
		const vad = await createVad({
			provider: "silero",
			dataDir: "/dev/null/not-a-directory",
		});
		expect(vad.name).toBe("energy");
	});
});

/**
 * The shape of the call into the model, checked without the model.
 *
 * These matter more than they look. Silero v5 wants 64 samples of the previous
 * chunk in front of the current one, and the exported graph accepts a dynamic
 * length — so getting this wrong throws nothing, returns a plausible number in
 * [0,1], and reports near-certain silence over the clearest speech. Every
 * assertion a real-model test can cheaply make (finite, in range, state
 * carried) passes while the detector is completely deaf, which is exactly what
 * shipped. So the contract is pinned here instead.
 */
describe("SileroVad input contract", () => {
	/** A stand-in session that records the input it was handed. */
	function fakeSession() {
		const inputs: Float32Array[] = [];
		const session = {
			run(feeds: Record<string, unknown>) {
				const input = feeds.input as { data: Float32Array; dims: number[] };
				inputs.push(Float32Array.from(input.data));
				return Promise.resolve({
					output: { data: [0.42] },
					stateN: { data: new Float32Array(2 * 1 * 128) },
				});
			},
		};
		const dims: number[][] = [];
		const makeTensor = (
			_type: "float32" | "int64",
			data: Float32Array | BigInt64Array,
			d: number[],
		) => {
			if (data instanceof Float32Array && d.length === 2) dims.push(d);
			return { data, dims: d };
		};
		return { session, makeTensor, inputs, dims };
	}

	it("prepends 64 samples of context, for 576 in total", async () => {
		const { session, makeTensor, inputs, dims } = fakeSession();
		const vad = new SileroVad(session, makeTensor);

		await vad.process(noise(1));
		expect(inputs[0]?.length).toBe(576);
		expect(dims[0]).toEqual([1, 576]);
	});

	it("starts from silent context and then carries the previous tail", async () => {
		const { session, makeTensor, inputs } = fakeSession();
		const vad = new SileroVad(session, makeTensor);

		const first = noise(1);
		await vad.process(first);
		// Nothing has been heard yet, so the model is told so explicitly.
		expect([...(inputs[0]?.slice(0, 64) ?? [])]).toEqual(new Array(64).fill(0));

		await vad.process(noise(2));
		// The second call opens with the last 64 samples of the first chunk.
		const tail = [...first.samples.slice(512 - 64)].map((v) => v / 32768);
		expect([...(inputs[1]?.slice(0, 64) ?? [])]).toEqual(tail);
	});

	it("forgets the context on reset, like the state", async () => {
		const { session, makeTensor, inputs } = fakeSession();
		const vad = new SileroVad(session, makeTensor);

		await vad.process(noise(1));
		vad.reset();
		await vad.process(noise(2));
		// A reset session is a new stretch of speech: no tail leaks across it.
		expect([...(inputs[1]?.slice(0, 64) ?? [])]).toEqual(new Array(64).fill(0));
	});
});

// The real model is not in the repo and CI has no network, so this only runs
// where a copy has been placed by hand.
const modelSource = process.env.SILERO_MODEL_PATH ?? "";
const haveModel = !!modelSource && existsSync(modelSource);

describe.skipIf(!haveModel)("SileroVad (real model)", () => {
	it("returns probabilities and carries its state between frames", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "companion-vad-"));
		mkdirSync(join(dataDir, "models"), { recursive: true });
		copyFileSync(modelSource, sileroModelPath(dataDir));

		const vad = await createSileroVad(dataDir);
		expect(vad.name).toBe("silero");

		// Synthetic audio is not speech, so we assert the contract rather than a
		// verdict: real judgements need real voice, which this repo does not ship.
		for (let i = 0; i < 5; i++) {
			const p = await vad.process(noise(i + 1));
			expect(Number.isFinite(p)).toBe(true);
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThanOrEqual(1);
		}
		expect(await vad.process(silence())).toBeLessThan(0.5);

		// Same frame, different answer: proof that stateN came back and was kept.
		vad.reset();
		const first = await vad.process(noise(9));
		const second = await vad.process(noise(9));
		expect(second).not.toBe(first);

		// And reset really rewinds: the first frame scores the same as before.
		vad.reset();
		expect(await vad.process(noise(9))).toBe(first);
	});

	it("refuses a frame that is not 512 samples", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "companion-vad-"));
		mkdirSync(join(dataDir, "models"), { recursive: true });
		copyFileSync(modelSource, sileroModelPath(dataDir));
		const vad = await createSileroVad(dataDir);
		await expect(vad.process(frameOf(new Int16Array(256)))).rejects.toThrow();
	});
});
