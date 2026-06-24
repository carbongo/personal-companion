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
 * never knows the input arrived as voice. See docs/configuration.md.
 */
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";

const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";

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

/** whisper.cpp args: transcribe `wav`, write plain text to `<outBase>.txt`. */
export function whisperArgs(
	model: string,
	wav: string,
	outBase: string,
	language: string,
): string[] {
	return [
		"-m",
		model,
		"-f",
		wav,
		"-l",
		language || "auto",
		"-nt", // no timestamps
		"-np", // no progress / system prints
		"-otxt",
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
	/** Read the transcript whisper.cpp wrote, given its output base path. */
	readText: (outBase: string) => Promise<string>;
	cleanup: (paths: string[]) => void;
	tmpBase: () => string;
}

const defaultLocalDeps: LocalDeps = {
	run: bunRun,
	readText: (outBase) => Bun.file(`${outBase}.txt`).text(),
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
 * Transcribe locally: write the bytes, normalize with ffmpeg, run whisper.cpp.
 * Deps are injected so the orchestration is unit-testable without binaries.
 */
export async function transcribeLocal(
	bytes: Uint8Array,
	filename: string,
	deps: LocalDeps = defaultLocalDeps,
): Promise<string> {
	const { localBin, localModel, ffmpegBin, language } = config.stt;
	if (!localModel || !existsSync(localModel))
		throw new Error(`whisper model not found: ${localModel || "(unset)"}`);

	const base = deps.tmpBase();
	const ext = filename.includes(".")
		? filename.slice(filename.lastIndexOf("."))
		: ".bin";
	// Keep the decoded wav distinct from the input — otherwise a .wav upload would
	// give ffmpeg the same path for input and output, which it refuses.
	const input = `${base}.in${ext}`;
	const wav = `${base}.wav`;
	const outBase = `${base}.out`;
	const made = [input, wav, `${outBase}.txt`];

	try {
		await Bun.write(input, bytes);

		const ff = await deps.run([ffmpegBin, ...ffmpegArgs(input, wav)]);
		if (ff.code !== 0)
			throw new Error(`ffmpeg failed (${ff.code}): ${ff.stderr.slice(0, 200)}`);

		const wc = await deps.run([
			localBin,
			...whisperArgs(localModel, wav, outBase, language),
		]);
		if (wc.code !== 0)
			throw new Error(
				`whisper-cli failed (${wc.code}): ${wc.stderr.slice(0, 200)}`,
			);

		return cleanWhisperText(await deps.readText(outBase));
	} finally {
		deps.cleanup(made);
	}
}

// --- HTTP (openai / whisper-http) --------------------------------------------

async function transcribeHttp(
	bytes: Uint8Array,
	filename: string,
): Promise<string> {
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
	const data = (await res.json()) as { text?: string };
	return (data.text ?? "").trim();
}

/**
 * Transcribe audio bytes to text. Throws on a transport, process, or API error
 * so the caller can fall back to a friendly "I couldn't make that out" message.
 */
export async function transcribe(
	bytes: Uint8Array,
	filename: string,
): Promise<string> {
	if (!sttConfigured()) throw new Error("STT is not configured");
	if (config.stt.provider === "local") return transcribeLocal(bytes, filename);
	return transcribeHttp(bytes, filename);
}
