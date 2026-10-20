/**
 * Text-to-speech for spoken replies. Pluggable and optional:
 *   - "off"   (default) — no audio is synthesized, only text goes out;
 *   - "openai" — the hosted OpenAI speech API;
 *   - "http"   — any OpenAI-compatible `/audio/speech`-style endpoint
 *                (e.g. a local speaches / OpenAI-compatible TTS server);
 *   - "local"  — Piper (`piper` CLI) run on this machine. No daemon, no
 *                network: everything stays on the box, and Piper's small
 *                ONNX voice models synthesize a short paragraph well under
 *                the latency a network round-trip would cost.
 *
 * Callers use `synthesize()` to turn a paragraph of text into audio bytes;
 * the engine never knows whether the reply is later played back or sent as a
 * voice note. See docs/configuration.md.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sniffAudioExt } from "#/companion-core/media.ts";
import { config, resolveLocalVoice } from "#/config/index.ts";

const OPENAI_SPEECH = "https://api.openai.com/v1/audio/speech";

/** Cyrillic and Latin letter ranges, used to guess a text's script. */
const CYRILLIC_RE = /[Ѐ-ӿ]/;
const LATIN_RE = /[a-zA-Z]/;
/**
 * Guess a language ("ru" | "en", or a `TTS_SCRIPT_MARKERS` language) from the
 * text's script, or `undefined` when it genuinely can't tell — empty text, digits/punctuation only, or a
 * near-even mix that shouldn't confidently flip the voice either way. Counts
 * letters only (ignoring whitespace, digits, punctuation) and requires a
 * clear majority so a single borrowed word doesn't swing the whole sentence.
 */
export function scriptLanguage(text: string): string | undefined {
	let cyrillic = 0;
	let latin = 0;
	for (const ch of text) {
		if (CYRILLIC_RE.test(ch)) cyrillic++;
		else if (LATIN_RE.test(ch)) latin++;
	}
	const total = cyrillic + latin;
	if (total === 0) return undefined;
	const ratio = cyrillic / total;
	const base = ratio >= 0.7 ? "ru" : ratio <= 0.3 ? "en" : undefined;
	return base && (markedLanguage(text) ?? base);
}

/** The first `TTS_SCRIPT_MARKERS` language with one of its letters in the text. */
function markedLanguage(text: string): string | undefined {
	for (const [lang, letters] of Object.entries(config.tts.scriptMarkers))
		if ([...letters].some((ch) => text.includes(ch))) return lang;
	return undefined;
}

/** Whether speech synthesis is set up; if false the caller just sends text. */
export function ttsConfigured(): boolean {
	const { provider, apiUrl, localModel } = config.tts;
	if (provider === "openai") return !!config.tts.apiKey;
	if (provider === "http") return !!apiUrl;
	// Local needs a voice model file actually present; otherwise behave like
	// "off" so replies keep flowing as text instead of failing every turn.
	if (provider === "local") return !!localModel && existsSync(localModel);
	return false;
}

/** Resolve the synthesis endpoint for an HTTP provider. */
function endpoint(): string {
	if (config.tts.provider === "openai") return OPENAI_SPEECH;
	return config.tts.apiUrl;
}

// --- local (Piper) ------------------------------------------------------------

/** Piper CLI args: read text from stdin, write a wav to `outPath`. */
export function piperArgs(model: string, outPath: string): string[] {
	return ["--model", model, "--output_file", outPath];
}

/** A spawned-process result; injected in tests so no binary is needed. */
export interface RunResult {
	code: number;
	stderr: string;
}
/** Runs `cmd`, feeding `input` (the text to speak) on stdin. */
export type Runner = (cmd: string[], input: string) => Promise<RunResult>;

/** Default runner: Bun.spawn, piping text in and capturing stderr. */
const bunRun: Runner = async (cmd, input) => {
	const proc = Bun.spawn(cmd, {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "pipe",
	});
	proc.stdin.write(input);
	proc.stdin.end();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { code, stderr };
};

export interface LocalDeps {
	run: Runner;
	/** Read the wav bytes Piper wrote, given its output path. */
	readBytes: (outPath: string) => Promise<Uint8Array>;
	cleanup: (paths: string[]) => void;
	tmpBase: () => string;
}

const defaultLocalDeps: LocalDeps = {
	run: bunRun,
	readBytes: async (outPath) =>
		new Uint8Array(await Bun.file(outPath).arrayBuffer()),
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
			`companion-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		),
};

/**
 * Synthesize speech locally with Piper. Deps are injected so the
 * orchestration is unit-testable without the actual binary.
 */
export async function synthesizeLocal(
	text: string,
	deps: LocalDeps = defaultLocalDeps,
	lang?: string,
): Promise<Uint8Array> {
	const { localBin } = config.tts;
	const localModel = lang ? resolveLocalVoice(lang) : config.tts.localModel;
	if (!localModel || !existsSync(localModel))
		throw new Error(`piper voice model not found: ${localModel || "(unset)"}`);

	const base = deps.tmpBase();
	const outPath = `${base}.wav`;

	try {
		const run = await deps.run(
			[localBin, ...piperArgs(localModel, outPath)],
			text,
		);
		if (run.code !== 0)
			throw new Error(
				`piper failed (${run.code}): ${run.stderr.slice(0, 200)}`,
			);

		return await deps.readBytes(outPath);
	} finally {
		deps.cleanup([outPath]);
	}
}

// --- HTTP (openai / http) -----------------------------------------------------

async function synthesizeHttp(
	text: string,
	lang?: string,
): Promise<Uint8Array> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (config.tts.apiKey) headers.authorization = `Bearer ${config.tts.apiKey}`;

	const body: Record<string, unknown> = {
		model: config.tts.model,
		input: text,
	};
	// TTS_LOCAL_MODEL_MAP is documented as Piper-only, so only use it here
	// when it actually names a voice for this language; otherwise a bare
	// local .onnx path (the fallback resolveLocalVoice() would give us) has
	// no meaning to an HTTP endpoint, so keep the configured default voice.
	const voice = (lang && config.tts.localModelByLang[lang]) || config.tts.voice;
	if (voice) body.voice = voice;
	// A self-hosted multilingual model needs the language more than a voice
	// name; the hosted OpenAI API rejects unknown fields, so only "http" gets it.
	if (lang && config.tts.provider === "http") body.language = lang;

	const res = await fetch(endpoint(), {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`TTS ${res.status} ${res.statusText} ${detail}`.trim());
	}
	return new Uint8Array(await res.arrayBuffer());
}

// --- voice-note encoding --------------------------------------------------------

/** Runs `cmd` with `input` on stdin and returns its stdout; injected in tests. */
export type PipeRunner = (
	cmd: string[],
	input: Uint8Array,
) => Promise<{ code: number; stdout: Uint8Array }>;

const bunPipe: PipeRunner = async (cmd, input) => {
	const proc = Bun.spawn(cmd, {
		stdin: input,
		stdout: "pipe",
		stderr: "ignore",
	});
	const stdout = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
	return { code: await proc.exited, stdout };
};

/** ffmpeg args: any audio on stdin to mono OGG/Opus on stdout. */
export function oggOpusArgs(): string[] {
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		"pipe:0",
		"-ac",
		"1",
		"-c:a",
		"libopus",
		"-b:a",
		"48k",
		"-f",
		"ogg",
		"pipe:1",
	];
}

/**
 * Re-encode synthesized audio as OGG/Opus, the only format Telegram renders
 * as a voice note with a waveform. Audio that is already OGG passes through;
 * if ffmpeg is missing or fails the original bytes are returned unchanged.
 */
export async function toOggOpus(
	audio: Uint8Array,
	run: PipeRunner = bunPipe,
): Promise<Uint8Array> {
	if (sniffAudioExt(audio) === ".ogg") return audio;
	try {
		const out = await run([config.stt.ffmpegBin, ...oggOpusArgs()], audio);
		if (out.code === 0 && sniffAudioExt(out.stdout) === ".ogg")
			return out.stdout;
	} catch {}
	return audio;
}

/**
 * Synthesize text to audio bytes. Throws on a transport, process, or API
 * error so the caller can fall back to sending plain text instead.
 *
 * `opts.lang` picks the voice explicitly; otherwise the language is guessed
 * from the text's own script. Because that inference runs per call, a reply
 * that's already been split into clauses (see channels/reply.ts) gets voiced
 * clause by clause — a mixed English/Russian reply switches voices mid-reply
 * instead of committing to whichever language happened to open the reply.
 */
export async function synthesize(
	text: string,
	opts?: { lang?: string },
): Promise<Uint8Array> {
	if (!ttsConfigured()) throw new Error("TTS is not configured");
	const lang = opts?.lang ?? scriptLanguage(text);
	if (config.tts.provider === "local")
		return synthesizeLocal(text, undefined, lang);
	return synthesizeHttp(text, lang);
}
