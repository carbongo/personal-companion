import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";
import {
	type LocalDeps,
	piperArgs,
	synthesizeLocal,
	ttsConfigured,
} from "./tts.ts";

const original = { ...config.tts };
afterEach(() => {
	Object.assign(config.tts, original);
});

describe("piper arg builder", () => {
	it("reads text from stdin and writes the given output path", () => {
		const a = piperArgs("voice.onnx", "out.wav");
		expect(a[a.indexOf("--model") + 1]).toBe("voice.onnx");
		expect(a[a.indexOf("--output_file") + 1]).toBe("out.wav");
	});
});

describe("ttsConfigured", () => {
	it("is false when off", () => {
		config.tts.provider = "off";
		expect(ttsConfigured()).toBe(false);
	});

	it("openai needs an api key", () => {
		config.tts.provider = "openai";
		config.tts.apiKey = "";
		expect(ttsConfigured()).toBe(false);
		config.tts.apiKey = "sk-test";
		expect(ttsConfigured()).toBe(true);
	});

	it("http needs an api url", () => {
		config.tts.provider = "http";
		config.tts.apiUrl = "";
		expect(ttsConfigured()).toBe(false);
		config.tts.apiUrl = "http://localhost:8000/audio/speech";
		expect(ttsConfigured()).toBe(true);
	});

	it("local needs a model file that actually exists", () => {
		config.tts.provider = "local";
		config.tts.localModel = "/nope/missing.onnx";
		expect(ttsConfigured()).toBe(false);
	});
});

describe("synthesizeLocal", () => {
	function withModel(): { dir: string; model: string } {
		const dir = mkdtempSync(join(tmpdir(), "tts-test-"));
		const model = join(dir, "voice.onnx");
		writeFileSync(model, "x"); // existsSync must pass
		config.tts.provider = "local";
		config.tts.localModel = model;
		config.tts.localBin = "piper";
		return { dir, model };
	}

	it("runs piper with the text on stdin and returns the wav bytes", async () => {
		const { dir } = withModel();
		const calls: { cmd: string[]; input: string }[] = [];
		const deps: LocalDeps = {
			run: async (cmd, input) => {
				calls.push({ cmd, input });
				return { code: 0, stderr: "" };
			},
			readBytes: async () => new Uint8Array([1, 2, 3]),
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		const bytes = await synthesizeLocal("hello friend", deps);
		expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cmd[0]).toBe("piper");
		expect(calls[0]?.cmd).toContain(config.tts.localModel);
		expect(calls[0]?.input).toBe("hello friend");

		rmSync(dir, { recursive: true, force: true });
	});

	it("throws a clear error when the model is missing", async () => {
		config.tts.provider = "local";
		config.tts.localModel = "/nope/missing.onnx";
		await expect(synthesizeLocal("hi")).rejects.toThrow(/model not found/);
	});

	it("surfaces a piper failure", async () => {
		const { dir } = withModel();
		const deps: LocalDeps = {
			run: async () => ({ code: 1, stderr: "bad voice" }),
			readBytes: async () => new Uint8Array(),
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await expect(synthesizeLocal("hi", deps)).rejects.toThrow(/piper failed/);
		rmSync(dir, { recursive: true, force: true });
	});
});
