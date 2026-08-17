/**
 * Speech-to-text for voice notes. Pluggable and optional:
 *   - "off"          (default) — voice is declined, the channel asks for text;
 *   - "openai"       — the hosted Whisper API;
 *   - "whisper-http" — any OpenAI-compatible `/audio/transcriptions` endpoint
 *                      (e.g. a local faster-whisper / speaches server);
 *   - "local"        — whisper.cpp's `whisper-cli` run on this machine, with
 *                      ffmpeg normalizing the audio first. No daemon, no network:
 *                      everything stays on the box, which also means it survives a
 *                      reboot without a second service to bring back up.
 *
 * Channels call `transcribe()` to turn audio bytes into a text turn; the engine
 * never knows the input arrived as voice. `transcribeDetailed()` is the same work
 * with the decoder's own signals kept, for callers that gate on them. See
 * docs/configuration.md.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";

const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";

/**
 * A transcription plus whatever the decoder told us about its own confidence.
 * Every extra is optional: a provider that cannot report one leaves it unset
 * rather than guessing, because a caller gating on a fabricated probability
 * would be worse off than one gating on nothing.
 */
export interface TranscriptionResult {
	text: string;
	/**
	 * Mean per-token probability, 0..1 — how sure the decoder was of the words
	 * it chose. Low means invention, which is what the hallucination gate wants
	 * to know. Only whisper.cpp reports it (from `-ojf`); the HTTP providers
	 * return no per-token data, so for them it stays unset.
	 */
	confidence?: number;
	/**
	 * The decoder's probability that the clip was silence. whisper-cli never
	 * emits this in any output mode — see `parseWhisperJson` — so it only ever
	 * arrives from a provider whose API reports it.
	 */
	noSpeechProb?: number;
	language?: string;
}

/** Whether voice transcription is set up; if false the channel asks for text. */
export function sttConfigured(): boolean {
	const { provider, apiUrl, localModel } = config.stt;
	if (provider === "openai") return !!config.stt.apiKey;
	if (provider === "whisper-http") return !!apiUrl;
	// Local needs a model file actually present; otherwise behave like "off" so
	// the channel asks for text instead of failing every voice note.
	if (provider === "local") return !!localModel && existsSync(localModel);
	return false;
}

/** Resolve the transcription endpoint for an HTTP provider. */
function endpoint(): string {
	if (config.stt.provider === "openai") return OPENAI_TRANSCRIPTIONS;
	return config.stt.apiUrl;
}

// --- clip duration -----------------------------------------------------------

/**
 * Duration of a RIFF/WAVE buffer in milliseconds, or undefined when the bytes
 * aren't a wav we can read (a Telegram .ogg voice note, say). Read from the
 * header rather than by decoding, so the check costs nothing and adds no
 * dependency; an unreadable buffer is simply not clip-length-checked.
 */
export function wavDurationMs(bytes: Uint8Array): number | undefined {
	if (bytes.length < 44) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (at: number) =>
		String.fromCharCode(
			bytes[at] ?? 0,
			bytes[at + 1] ?? 0,
			bytes[at + 2] ?? 0,
			bytes[at + 3] ?? 0,
		);
	if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;

	let byteRate = 0;
	let pos = 12;
	while (pos + 8 <= bytes.length) {
		const id = tag(pos);
		const declared = view.getUint32(pos + 4, true);
		const body = pos + 8;
		// The fmt chunk carries the bytes-per-second directly, which is all we
		// need — no need to reason about channels, width and rate separately.
		if (id === "fmt " && declared >= 16)
			byteRate = view.getUint32(body + 8, true);
		if (id === "data") {
			if (!byteRate) return undefined;
			const available = bytes.length - body;
			// Streamed wavs are often written with a placeholder size, so trust
			// what actually arrived whenever the declared size doesn't fit.
			const size = declared > 0 && declared <= available ? declared : available;
			return Math.round((size / byteRate) * 1000);
		}
		pos = body + declared + (declared % 2); // chunks are word-aligned
	}
	return undefined;
}

// --- language detection and clamping -----------------------------------------

// Script families, kept deliberately small: just enough to tell "this detection
// and one of the configured languages are written the same way" apart from
// "these have nothing in common". It is a heuristic, not a linguistic model —
// whisper can return any of 99 languages, and a mumbled English phrase coming
// back as Kazakh must not be decoded as Kazakh.
const CYRILLIC_SCRIPT = new Set([
	"ru",
	"uk",
	"be",
	"bg",
	"kk",
	"mk",
	"sr",
	"mn",
	"ky",
	"tg",
]);
const LATIN_SCRIPT = new Set([
	"en",
	"de",
	"fr",
	"es",
	"it",
	"pt",
	"nl",
	"pl",
	"cs",
	"sk",
	"sv",
	"no",
	"da",
	"fi",
	"tr",
	"id",
	"ro",
	"hu",
	"vi",
	"ca",
	"hr",
	"sl",
	"lt",
	"lv",
	"et",
	"cy",
]);

/**
 * Snap a detected language to the set the owner actually speaks. An empty set
 * means "unrestricted" and the detection is returned untouched; otherwise we
 * prefer a member written in the same script, and fall back to the first
 * configured language when even that fails.
 */
export function clampLanguage(detected: string, allowed: string[]): string {
	const first = allowed[0];
	if (!first) return detected;
	if (!detected) return first;
	if (allowed.includes(detected)) return detected;

	const family = CYRILLIC_SCRIPT.has(detected)
		? CYRILLIC_SCRIPT
		: LATIN_SCRIPT.has(detected)
			? LATIN_SCRIPT
			: null;
	const sameScript = family && allowed.find((l) => family.has(l));
	return sameScript || first;
}

/**
 * whisper.cpp args for a detect-and-exit pass. Cheap enough (a fraction of a
 * second with a tiny model) that paying it beats letting the main model
 * auto-detect, which roughly doubles its decode cost. `-np` is deliberately
 * absent: it would suppress the very line we parse.
 */
export function detectArgs(model: string, wav: string): string[] {
	return ["-m", model, "-f", wav, "-dl"];
}

/**
 * Pull the code out of whisper.cpp's detection line, e.g.
 * `whisper_full_with_state: auto-detected language: en (p = 0.740969)`.
 * Returns "" when the line isn't there, which the caller treats as "no opinion".
 */
export function parseDetectedLanguage(output: string): string {
	return /auto-detected language:\s*([a-z]{2,3})\b/.exec(output)?.[1] ?? "";
}

// --- local (whisper.cpp) -----------------------------------------------------

/** ffmpeg args: decode anything to the 16 kHz mono wav whisper.cpp expects. */
export function ffmpegArgs(input: string, wav: string): string[] {
	return [
		"-nostdin",
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-i",
		input,
		"-ar",
		"16000",
		"-ac",
		"1",
		"-c:a",
		"pcm_s16le",
		"-f",
		"wav",
		wav,
	];
}

/** The decoder-failure thresholds whisper.cpp accepts, passed straight through. */
export interface DecodeThresholds {
	noSpeech: number;
	entropy: number;
	logprob: number;
}

/**
 * whisper.cpp args: transcribe `wav`, write JSON to `<outBase>.json`. JSON
 * rather than plain text because it also carries the language the run settled
 * on, and one file is easier to clean up than two.
 *
 * `-ojf` (full JSON, which implies `-oj`) rather than plain `-oj`: the full
 * writer is the only mode that emits the per-token probabilities, and that mean
 * is the one confidence signal whisper-cli actually gives us.
 */
export function whisperArgs(
	model: string,
	wav: string,
	outBase: string,
	language: string,
	thresholds: DecodeThresholds,
): string[] {
	return [
		"-m",
		model,
		"-f",
		wav,
		"-l",
		language || "auto",
		"-nth",
		String(thresholds.noSpeech),
		"-et",
		String(thresholds.entropy),
		"-lpt",
		String(thresholds.logprob),
		"-nt", // no timestamps
		"-np", // no progress / system prints
		"-ojf", // full JSON: segments *and* per-token probabilities
		"-of",
		outBase,
	];
}

/** Collapse whisper's line-per-segment text into one trimmed transcript. */
export function cleanWhisperText(raw: string): string {
	return raw
		.split("\n")
		.map((l) => l.replace(/^\s*\[[^\]]*\]\s*/, "").trim()) // drop any [..] timestamps
		.filter(Boolean)
		.join(" ")
		.trim();
}

// Special tokens whisper writes into the full JSON alongside real words —
// `[_BEG_]`, `[_TT_88]`, `[_EOT_]`. Their probabilities describe the decoder's
// bookkeeping, not the words the owner said, so they are left out of the mean.
const SPECIAL_TOKEN = /^\[_[^\]]*\]$/;

/**
 * Average the per-token probabilities `-ojf` writes, across every segment.
 * Flattening first makes this a count-weighted mean: a ten-token segment
 * carries ten times the weight of a one-token one, which is the honest reading
 * when the question is "how sure was the decoder of these words".
 *
 * A run that yields no usable token returns undefined rather than a default —
 * the gate must act on a measurement or on nothing at all.
 */
function meanTokenProbability(segments: unknown[]): number | undefined {
	let sum = 0;
	let count = 0;
	for (const segment of segments) {
		if (!segment || typeof segment !== "object") continue;
		const tokens = (segment as { tokens?: unknown }).tokens;
		if (!Array.isArray(tokens)) continue;
		for (const token of tokens) {
			if (!token || typeof token !== "object") continue;
			const { p, text } = token as { p?: unknown; text?: unknown };
			if (typeof p !== "number" || !Number.isFinite(p)) continue;
			if (typeof text === "string" && SPECIAL_TOKEN.test(text.trim())) continue;
			sum += p;
			count++;
		}
	}
	return count > 0 ? sum / count : undefined;
}

/**
 * Read back what `-ojf` wrote. Anything unexpected — unparseable JSON, a missing
 * transcription array — yields an empty transcript rather than a partial guess,
 * on the principle that silence is recoverable and invented words are not.
 *
 * Note there is no `noSpeechProb` here: whisper-cli's JSON writer emits neither
 * `no_speech_prob` nor any equivalent, under `-oj` or `-ojf`. The threshold is
 * still applied inside the decoder via `-nth`; we just cannot observe it. The
 * per-token `p` values are what we can observe, hence `confidence`.
 */
export function parseWhisperJson(raw: string): {
	text: string;
	confidence?: number;
	language?: string;
} {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { text: "" };
	}
	if (!data || typeof data !== "object") return { text: "" };

	const doc = data as {
		result?: { language?: unknown };
		transcription?: unknown;
	};
	const segments = Array.isArray(doc.transcription) ? doc.transcription : [];
	const text = cleanWhisperText(
		segments
			.map((s) =>
				s &&
				typeof s === "object" &&
				typeof (s as { text?: unknown }).text === "string"
					? (s as { text: string }).text
					: "",
			)
			.join("\n"),
	);

	const confidence = meanTokenProbability(segments);
	const language = doc.result?.language;
	return {
		text,
		...(confidence === undefined ? {} : { confidence }),
		...(typeof language === "string" && language ? { language } : {}),
	};
}

/** A spawned-process result; injected in tests so no binary is needed. */
export interface RunResult {
	code: number;
	stderr: string;
}
export type Runner = (cmd: string[]) => Promise<RunResult>;

/** Default runner: Bun.spawn, capturing stderr for error messages. */
const bunRun: Runner = async (cmd) => {
	const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { code, stderr };
};

export interface LocalDeps {
	run: Runner;
	/** Read the JSON whisper.cpp wrote, given its output base path. */
	readOutput: (outBase: string) => Promise<string>;
	cleanup: (paths: string[]) => void;
	tmpBase: () => string;
}

const defaultLocalDeps: LocalDeps = {
	run: bunRun,
	readOutput: (outBase) => Bun.file(`${outBase}.json`).text(),
	cleanup: (paths) => {
		for (const p of paths) {
			try {
				rmSync(p, { force: true });
			} catch {}
		}
	},
	tmpBase: () =>
		join(
			tmpdir(),
			`companion-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		),
};

/**
 * Decide which language the decode pass runs at.
 *
 * An explicit `STT_LANGUAGE` wins outright — the owner has told us, so there is
 * nothing to detect. Otherwise, when a detect model is configured, a fast
 * detect-and-exit pass gives an opinion that we clamp to the configured
 * languages. With no detect model we keep the old behaviour untouched and let
 * the main model sort it out.
 */
async function resolveLanguage(wav: string, deps: LocalDeps): Promise<string> {
	const { language, detectModel, languages, localBin } = config.stt;
	if (language && language !== "auto") return language;
	if (!detectModel) return language;

	const pass = await deps.run([localBin, ...detectArgs(detectModel, wav)]);
	// A failed detect pass is not fatal: fall back to the owner's primary
	// language rather than handing the big model an expensive "auto".
	const detected = pass.code === 0 ? parseDetectedLanguage(pass.stderr) : "";
	if (!detected) return languages[0] || language;
	return clampLanguage(detected, languages);
}

/**
 * Transcribe locally: write the bytes, normalize with ffmpeg, run whisper.cpp.
 * Deps are injected so the orchestration is unit-testable without binaries.
 */
export async function transcribeLocal(
	bytes: Uint8Array,
	filename: string,
	deps: LocalDeps = defaultLocalDeps,
): Promise<TranscriptionResult> {
	const { localBin, localModel, ffmpegBin, minClipMs } = config.stt;
	if (!localModel || !existsSync(localModel))
		throw new Error(`whisper model not found: ${localModel || "(unset)"}`);

	// Very short clips are where whisper invents whole sentences out of a cough,
	// so they never reach the binary at all.
	const durationMs = wavDurationMs(bytes);
	if (durationMs !== undefined && durationMs < minClipMs) return { text: "" };

	const base = deps.tmpBase();
	const ext = filename.includes(".")
		? filename.slice(filename.lastIndexOf("."))
		: ".bin";
	// Keep the decoded wav distinct from the input — otherwise a .wav upload would
	// give ffmpeg the same path for input and output, which it refuses.
	const input = `${base}.in${ext}`;
	const wav = `${base}.wav`;
	const outBase = `${base}.out`;
	const made = [input, wav, `${outBase}.json`];

	try {
		await Bun.write(input, bytes);

		const ff = await deps.run([ffmpegBin, ...ffmpegArgs(input, wav)]);
		if (ff.code !== 0)
			throw new Error(`ffmpeg failed (${ff.code}): ${ff.stderr.slice(0, 200)}`);

		const language = await resolveLanguage(wav, deps);

		const wc = await deps.run([
			localBin,
			...whisperArgs(localModel, wav, outBase, language, {
				noSpeech: config.stt.noSpeechThreshold,
				entropy: config.stt.entropyThreshold,
				logprob: config.stt.logprobThreshold,
			}),
		]);
		if (wc.code !== 0)
			throw new Error(
				`whisper-cli failed (${wc.code}): ${wc.stderr.slice(0, 200)}`,
			);

		const parsed = parseWhisperJson(await deps.readOutput(outBase));
		return {
			text: parsed.text,
			// Spread rather than assign: an undefined confidence must stay absent,
			// so a caller cannot mistake "not measured" for "measured as zero".
			...(parsed.confidence === undefined
				? {}
				: { confidence: parsed.confidence }),
			language: parsed.language ?? language,
		};
	} finally {
		deps.cleanup(made);
	}
}

// --- HTTP (openai / whisper-http) --------------------------------------------

async function transcribeHttp(
	bytes: Uint8Array,
	filename: string,
): Promise<TranscriptionResult> {
	const form = new FormData();
	form.append("file", new Blob([bytes]), filename);
	form.append("model", config.stt.model);

	const headers: Record<string, string> = {};
	if (config.stt.apiKey) headers.authorization = `Bearer ${config.stt.apiKey}`;

	const res = await fetch(endpoint(), { method: "POST", headers, body: form });
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`STT ${res.status} ${res.statusText} ${detail}`.trim());
	}
	const data = (await res.json()) as { text?: string; language?: string };
	return {
		text: (data.text ?? "").trim(),
		...(data.language ? { language: data.language } : {}),
	};
}

/**
 * Transcribe audio bytes, keeping whatever the provider reports alongside the
 * words. Throws on a transport, process, or API error so the caller can fall
 * back to a friendly "I couldn't make that out" message.
 */
export async function transcribeDetailed(
	bytes: Uint8Array,
	filename: string,
): Promise<TranscriptionResult> {
	if (!sttConfigured()) throw new Error("STT is not configured");
	if (config.stt.provider === "local") return transcribeLocal(bytes, filename);
	return transcribeHttp(bytes, filename);
}

/** Transcribe audio bytes to text, for callers that only want the words. */
export async function transcribe(
	bytes: Uint8Array,
	filename: string,
): Promise<string> {
	return (await transcribeDetailed(bytes, filename)).text;
}
