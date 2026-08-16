/**
 * Voice activity detection for live calls. Two detectors, one interface:
 *
 *   - "energy" — RMS plus zero-crossing rate against an adaptive noise floor.
 *     Dependency-free and always available, so a call never fails to start.
 *   - "silero" — the small ONNX model everyone uses for this, run through
 *     onnxruntime-node. Much better on room noise, keyboard clatter, and the
 *     half-second of breath before a word. It is an *optional* dependency:
 *     the native binding may be missing on this platform and the model has to
 *     be downloaded once, so both are attempted behind a guard and neither is
 *     allowed to take the process down. We fall back to energy and say so once.
 *
 * The model file is cached under <dataDir>/models/ and never committed; it is
 * MIT-licensed and about 2.3 MB.
 *
 * Both detectors only answer "how much speech is in this frame". Turning that
 * into utterances is framing.ts's job.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VAD_FRAME_SIZE } from "#/companion-core/call/resample.ts";
import type {
	PcmFrame,
	VoiceActivityDetector,
} from "#/companion-core/call/types.ts";

// --- energy ------------------------------------------------------------------

/** Below this RMS a frame is treated as digital silence, whatever the floor says. */
const ABS_SILENCE_RMS = 20;
/** SNR over the noise floor, in dB, between "certainly not speech" and "certainly is". */
const SNR_LOW_DB = 6;
const SNR_HIGH_DB = 15;
/** Above this zero-crossing rate a frame looks like hiss rather than voice. */
const ZCR_SPEECH_MAX = 0.3;
const ZCR_NOISE = 0.55;
/** Noise floor adaptation: drop to a quiet frame quickly, rise to a loud one slowly. */
const FLOOR_DOWN = 0.5;
const FLOOR_UP = 0.01;
const FLOOR_INITIAL = 50;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** RMS amplitude of a frame, in Int16 units. */
export function rms(samples: Int16Array): number {
	if (samples.length === 0) return 0;
	let acc = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i] ?? 0;
		acc += s * s;
	}
	return Math.sqrt(acc / samples.length);
}

/** Fraction of adjacent sample pairs that change sign. Hiss is high, voice is low. */
export function zeroCrossingRate(samples: Int16Array): number {
	if (samples.length < 2) return 0;
	let crossings = 0;
	for (let i = 1; i < samples.length; i++) {
		if ((samples[i] ?? 0) >= 0 !== (samples[i - 1] ?? 0) >= 0) crossings++;
	}
	return crossings / (samples.length - 1);
}

/**
 * The always-available detector. It is deliberately conservative about noise:
 * the floor tracks quiet frames almost immediately and loud ones over a few
 * seconds, so a constant hum stops reading as speech shortly after it starts,
 * while a pause between words pulls the floor straight back down.
 */
export class EnergyVad implements VoiceActivityDetector {
	readonly name = "energy";
	private floor = FLOOR_INITIAL;

	reset(): void {
		this.floor = FLOOR_INITIAL;
	}

	process(frame: PcmFrame): number {
		const level = rms(frame.samples);
		if (level < ABS_SILENCE_RMS) {
			this.adapt(level);
			return 0;
		}

		const reference = Math.max(this.floor, ABS_SILENCE_RMS);
		const snrDb = 20 * Math.log10(level / reference);
		let p = clamp01((snrDb - SNR_LOW_DB) / (SNR_HIGH_DB - SNR_LOW_DB));

		// Broadband hiss is as loud as speech but crosses zero far more often;
		// scale it back rather than rejecting it outright, because fricatives
		// live up here too.
		const zcr = zeroCrossingRate(frame.samples);
		if (zcr > ZCR_SPEECH_MAX) {
			p *= clamp01(1 - (zcr - ZCR_SPEECH_MAX) / (ZCR_NOISE - ZCR_SPEECH_MAX));
		}

		this.adapt(level);
		return p;
	}

	private adapt(level: number): void {
		const rate = level < this.floor ? FLOOR_DOWN : FLOOR_UP;
		this.floor += rate * (level - this.floor);
	}
}

// --- silero ------------------------------------------------------------------

export const SILERO_MODEL_URL =
	"https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx";

/** Where the model is cached. `data/` is gitignored, so it never reaches the repo. */
export function sileroModelPath(dataDir: string): string {
	return join(dataDir, "models", "silero_vad.onnx");
}

/**
 * Minimal structural types for the bits of onnxruntime we touch. Declared here
 * rather than imported so this file still type-checks on a machine where the
 * optional dependency was skipped.
 */
interface OnnxValue {
	data: ArrayLike<number>;
}
interface OnnxSession {
	run(feeds: Record<string, unknown>): Promise<Record<string, OnnxValue>>;
}

/** The state vector Silero carries between frames: float32 [2, 1, 128]. */
const SILERO_STATE_SIZE = 2 * 1 * 128;

export class SileroVad implements VoiceActivityDetector {
	readonly name = "silero";
	private state = new Float32Array(SILERO_STATE_SIZE);

	constructor(
		private readonly session: OnnxSession,
		private readonly makeTensor: (
			type: "float32" | "int64",
			data: Float32Array | BigInt64Array,
			dims: number[],
		) => unknown,
	) {}

	reset(): void {
		this.state = new Float32Array(SILERO_STATE_SIZE);
	}

	async process(frame: PcmFrame): Promise<number> {
		if (frame.samples.length !== VAD_FRAME_SIZE)
			throw new Error(
				`silero expects ${VAD_FRAME_SIZE}-sample frames, got ${frame.samples.length}`,
			);

		const input = new Float32Array(VAD_FRAME_SIZE);
		for (let i = 0; i < VAD_FRAME_SIZE; i++)
			input[i] = (frame.samples[i] ?? 0) / 32768;

		const out = await this.session.run({
			input: this.makeTensor("float32", input, [1, VAD_FRAME_SIZE]),
			state: this.makeTensor("float32", this.state, [2, 1, 128]),
			sr: this.makeTensor("int64", BigInt64Array.from([16000n]), []),
		});

		// The model hands back its next state; losing it would make every frame
		// look like the first one and the probabilities would jitter.
		const next = out.stateN;
		if (next) this.state = Float32Array.from(next.data as ArrayLike<number>);
		return Number(out.output?.data[0] ?? 0);
	}
}

/** Download the model once into the cache directory. Throws if it cannot. */
export async function ensureSileroModel(dataDir: string): Promise<string> {
	const path = sileroModelPath(dataDir);
	if (await Bun.file(path).exists()) return path;

	// Make the cache directory first: if the data dir is unusable there is no
	// point spending 2.3 MB of somebody's connection to find that out.
	mkdirSync(dirname(path), { recursive: true });
	const res = await fetch(SILERO_MODEL_URL);
	if (!res.ok) throw new Error(`silero model download failed: ${res.status}`);
	await Bun.write(path, new Uint8Array(await res.arrayBuffer()));
	return path;
}

/**
 * Build a Silero detector, or throw. The runtime is imported through a
 * non-literal specifier so a missing optional dependency is a caught runtime
 * error rather than a build-time one.
 */
export async function createSileroVad(dataDir: string): Promise<SileroVad> {
	const specifier = "onnxruntime-node";
	const ort = await import(specifier);
	const path = await ensureSileroModel(dataDir);
	const session = (await ort.InferenceSession.create(path)) as OnnxSession;
	return new SileroVad(
		session,
		(type, data, dims) => new ort.Tensor(type, data, dims),
	);
}

// --- factory -----------------------------------------------------------------

export type VadProviderName = "auto" | "silero" | "energy";

/**
 * What the call engine needs to build a detector. Narrow on purpose: the
 * caller reads these off `config` and passes them in, so this module stays
 * independent of how they are spelled in the environment.
 */
export interface VadOptions {
	provider?: VadProviderName;
	/** Speech probability the framing layer treats as speech; carried here so callers have one object. */
	threshold?: number;
	dataDir?: string;
}

let fallbackAnnounced = false;

/** Say once, calmly, why we are on the simpler detector — then stop mentioning it. */
function announceFallback(reason: unknown): void {
	if (fallbackAnnounced) return;
	fallbackAnnounced = true;
	const detail = reason instanceof Error ? reason.message : String(reason);
	console.log(`[call] Silero VAD unavailable, using energy VAD (${detail})`);
}

/** Reset the once-only notice; exists for tests. */
export function resetVadFallbackNotice(): void {
	fallbackAnnounced = false;
}

/**
 * Pick a detector. "silero" and "auto" both fall back to energy when the
 * runtime or the model is missing — a call with a cruder VAD is better than
 * no call at all.
 */
export async function createVad(
	options: VadOptions = {},
): Promise<VoiceActivityDetector> {
	const provider = options.provider ?? "auto";
	if (provider === "energy") return new EnergyVad();

	try {
		return await createSileroVad(options.dataDir ?? "./data");
	} catch (err) {
		announceFallback(err);
		return new EnergyVad();
	}
}
