import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";
import {
	cleanWhisperText,
	ffmpegArgs,
	type LocalDeps,
	transcribeLocal,
	whisperArgs,
} from "./stt.ts";

const original = { ...config.stt };
afterEach(() => {
	Object.assign(config.stt, original);
});

describe("whisper arg builders", () => {
	it("ffmpeg normalizes to 16 kHz mono wav", () => {
		const a = ffmpegArgs("in.ogg", "out.wav");
		expect(a).toContain("-ar");
		expect(a[a.indexOf("-ar") + 1]).toBe("16000");
		expect(a[a.indexOf("-ac") + 1]).toBe("1");
		expect(a.at(-1)).toBe("out.wav");
	});

	it("whisper-cli writes plain text and honors the language hint", () => {
		const a = whisperArgs("m.bin", "x.wav", "x.out", "auto");
		expect(a[a.indexOf("-m") + 1]).toBe("m.bin");
		expect(a[a.indexOf("-l") + 1]).toBe("auto");
		expect(a).toContain("-nt");
		expect(a).toContain("-otxt");
		expect(a[a.indexOf("-of") + 1]).toBe("x.out");
	});

	it("empty language falls back to auto", () => {
		expect(
			whisperArgs("m", "w", "o", "")[
				whisperArgs("m", "w", "o", "").indexOf("-l") + 1
			],
		).toBe("auto");
	});
});

describe("cleanWhisperText", () => {
	it("strips timestamps and folds segments into one line", () => {
		const raw =
			"[00:00.000 --> 00:02.000]  Hello there\n[00:02.000 --> 00:04.000]  friend\n";
		expect(cleanWhisperText(raw)).toBe("Hello there friend");
	});

	it("trims plain output", () => {
		expect(cleanWhisperText("  just text \n\n")).toBe("just text");
	});
});

describe("transcribeLocal", () => {
	function withModel(): { dir: string; model: string } {
		const dir = mkdtempSync(join(tmpdir(), "stt-test-"));
		const model = join(dir, "ggml-test.bin");
		writeFileSync(model, "x"); // existsSync must pass
		config.stt.provider = "local";
		config.stt.localModel = model;
		config.stt.localBin = "whisper-cli";
		config.stt.ffmpegBin = "ffmpeg";
		config.stt.language = "auto";
		return { dir, model };
	}

	it("runs ffmpeg then whisper and returns the transcript", async () => {
		const { dir } = withModel();
		const calls: string[][] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push(cmd);
				return { code: 0, stderr: "" };
			},
			readText: async () => "  the transcript  ",
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		const text = await transcribeLocal(
			new Uint8Array([1, 2, 3]),
			"voice.ogg",
			deps,
		);
		expect(text).toBe("the transcript");
		expect(calls).toHaveLength(2);
		expect(calls[0]?.[0]).toBe("ffmpeg");
		expect(calls[1]?.[0]).toBe("whisper-cli");
		expect(calls[1]).toContain(config.stt.localModel);

		rmSync(dir, { recursive: true, force: true });
	});

	it("keeps ffmpeg input and output distinct for a .wav upload", async () => {
		const { dir } = withModel();
		let ffmpeg: string[] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				if (cmd[0] === "ffmpeg") ffmpeg = cmd;
				return { code: 0, stderr: "" };
			},
			readText: async () => "ok",
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await transcribeLocal(new Uint8Array([1]), "clip.wav", deps);
		const input = ffmpeg[ffmpeg.indexOf("-i") + 1];
		const output = ffmpeg.at(-1);
		expect(input).not.toBe(output); // would collide if both were base.wav
		rmSync(dir, { recursive: true, force: true });
	});

	it("throws a clear error when the model is missing", async () => {
		config.stt.provider = "local";
		config.stt.localModel = "/nope/missing.bin";
		await expect(transcribeLocal(new Uint8Array([0]), "v.ogg")).rejects.toThrow(
			/model not found/,
		);
	});

	it("surfaces an ffmpeg failure", async () => {
		const { dir } = withModel();
		const deps: LocalDeps = {
			run: async (cmd) =>
				cmd[0] === "ffmpeg"
					? { code: 1, stderr: "bad input" }
					: { code: 0, stderr: "" },
			readText: async () => "",
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await expect(
			transcribeLocal(new Uint8Array([0]), "v.ogg", deps),
		).rejects.toThrow(/ffmpeg failed/);
		rmSync(dir, { recursive: true, force: true });
	});
});
