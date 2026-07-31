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

import { config } from "#/config/index.ts";

const OPENAI_SPEECH = "https://api.openai.com/v1/audio/speech";

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
): Promise<Uint8Array> {
	const { localBin, localModel } = config.tts;
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

async function synthesizeHttp(text: string): Promise<Uint8Array> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (config.tts.apiKey) headers.authorization = `Bearer ${config.tts.apiKey}`;

	const body: Record<string, unknown> = {
		model: config.tts.model,
		input: text,
	};
	if (config.tts.voice) body.voice = config.tts.voice;

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

/**
 * Synthesize text to audio bytes. Throws on a transport, process, or API
 * error so the caller can fall back to sending plain text instead.
 */
export async function synthesize(text: string): Promise<Uint8Array> {
	if (!ttsConfigured()) throw new Error("TTS is not configured");
	if (config.tts.provider === "local") return synthesizeLocal(text);
	return synthesizeHttp(text);
}
