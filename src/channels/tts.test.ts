import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";
import {
	type LocalDeps,
	piperArgs,
	scriptLanguage,
	synthesize,
	synthesizeLocal,
	toOggOpus,
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

describe("scriptLanguage", () => {
	it("detects pure Cyrillic as Russian", () => {
		expect(scriptLanguage("Привет, как дела?")).toBe("ru");
	});

	it("detects pure Latin as English", () => {
		expect(scriptLanguage("Hello, how are you?")).toBe("en");
	});

	it("stays with the majority script when a minority of the other is present", () => {
		expect(scriptLanguage("I'll take the борщ, please, thanks a lot")).toBe(
			"en",
		);
		expect(scriptLanguage("Возьму borscht, пожалуйста, спасибо большое")).toBe(
			"ru",
		);
	});

	it("returns undefined for a near-even mix", () => {
		expect(scriptLanguage("hello привет")).toBeUndefined();
	});

	it("returns undefined for digits and punctuation only", () => {
		expect(scriptLanguage("123 - 456, ... !!")).toBeUndefined();
	});

	it("returns undefined for empty text", () => {
		expect(scriptLanguage("")).toBeUndefined();
	});

	it("picks a marker language by its distinguishing letters", () => {
		config.tts.scriptMarkers = { uk: "єїґі" };
		expect(scriptLanguage("Привіт, як справи?")).toBe("uk");
		expect(scriptLanguage("Привет, как дела?")).toBe("ru");
	});
});

describe("http provider", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	function capture(): { body?: Record<string, unknown> } {
		const seen: { body?: Record<string, unknown> } = {};
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			seen.body = JSON.parse(String(init.body));
			return new Response(new Uint8Array([1, 2, 3]));
		}) as unknown as typeof fetch;
		return seen;
	}

	it("sends the guessed language to a self-hosted endpoint", async () => {
		Object.assign(config.tts, {
			provider: "http",
			apiUrl: "http://127.0.0.1:9/v1/audio/speech",
			localModelByLang: {},
			scriptMarkers: { uk: "єїґі" },
		});
		const seen = capture();
		await synthesize("Привіт, як справи?");
		expect(seen.body?.language).toBe("uk");
	});

	it("never sends a language field to the hosted OpenAI API", async () => {
		Object.assign(config.tts, { provider: "openai", apiKey: "k" });
		const seen = capture();
		await synthesize("Hello there");
		expect(seen.body && "language" in seen.body).toBe(false);
	});
});

describe("toOggOpus", () => {
	const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0]);
	const wav = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ");

	it("passes OGG through without running ffmpeg", async () => {
		let ran = false;
		const out = await toOggOpus(ogg, async () => {
			ran = true;
			return { code: 0, stdout: ogg };
		});
		expect(out).toBe(ogg);
		expect(ran).toBe(false);
	});

	it("re-encodes other audio to OGG/Opus", async () => {
		let cmd: string[] = [];
		const out = await toOggOpus(wav, async (c) => {
			cmd = c;
			return { code: 0, stdout: ogg };
		});
		expect(out).toBe(ogg);
		expect(cmd).toContain("libopus");
	});

	it("keeps the original bytes when ffmpeg fails", async () => {
		const out = await toOggOpus(wav, async () => ({
			code: 1,
			stdout: new Uint8Array(),
		}));
		expect(out).toBe(wav);
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

	it("picks the per-language voice when the map has an entry", async () => {
		const { dir } = withModel();
		const ruModel = join(dir, "ru.onnx");
		writeFileSync(ruModel, "x");
		config.tts.localModelByLang = { ru: ruModel };

		const calls: { cmd: string[] }[] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push({ cmd });
				return { code: 0, stderr: "" };
			},
			readBytes: async () => new Uint8Array(),
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		await synthesizeLocal("Привет", deps, "ru");
		expect(calls[0]?.cmd).toContain(ruModel);

		rmSync(dir, { recursive: true, force: true });
	});

	it("falls back to the default model when the language has no map entry", async () => {
		const { dir, model } = withModel();
		config.tts.localModelByLang = { ru: join(dir, "ru.onnx") };

		const calls: { cmd: string[] }[] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push({ cmd });
				return { code: 0, stderr: "" };
			},
			readBytes: async () => new Uint8Array(),
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		await synthesizeLocal("hello", deps, "en");
		expect(calls[0]?.cmd).toContain(model);

		rmSync(dir, { recursive: true, force: true });
	});
});
