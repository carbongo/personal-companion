import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";
import {
	clampLanguage,
	cleanWhisperText,
	detectArgs,
	ffmpegArgs,
	type LocalDeps,
	parseDetectedLanguage,
	parseWhisperJson,
	transcribeLocal,
	wavDurationMs,
	whisperArgs,
} from "./stt.ts";

const original = { ...config.stt };
afterEach(() => {
	Object.assign(config.stt, original);
});

const THOLDS = { noSpeech: 0.6, entropy: 2.4, logprob: -1 };

/** A minimal 16 kHz mono 16-bit wav header plus `sampleBytes` of silence. */
function wav(sampleBytes: number, byteRate = 32000): Uint8Array {
	const buf = new Uint8Array(44 + sampleBytes);
	const view = new DataView(buf.buffer);
	const put = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
	};
	put(0, "RIFF");
	view.setUint32(4, 36 + sampleBytes, true);
	put(8, "WAVE");
	put(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, 16000, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	put(36, "data");
	view.setUint32(40, sampleBytes, true);
	return buf;
}

describe("whisper arg builders", () => {
	it("ffmpeg normalizes to 16 kHz mono wav", () => {
		const a = ffmpegArgs("in.ogg", "out.wav");
		expect(a).toContain("-ar");
		expect(a[a.indexOf("-ar") + 1]).toBe("16000");
		expect(a[a.indexOf("-ac") + 1]).toBe("1");
		expect(a.at(-1)).toBe("out.wav");
	});

	it("whisper-cli writes JSON and honors the language hint", () => {
		const a = whisperArgs("m.bin", "x.wav", "x.out", "en", THOLDS);
		expect(a[a.indexOf("-m") + 1]).toBe("m.bin");
		expect(a[a.indexOf("-l") + 1]).toBe("en");
		expect(a).toContain("-nt");
		// Full JSON, not plain -oj: only the full writer emits per-token
		// probabilities, which is the confidence signal the gate runs on.
		expect(a).toContain("-ojf");
		expect(a[a.indexOf("-of") + 1]).toBe("x.out");
	});

	it("passes the decoder thresholds through", () => {
		const a = whisperArgs("m", "w", "o", "en", {
			noSpeech: 0.7,
			entropy: 2.2,
			logprob: -0.8,
		});
		expect(a[a.indexOf("-nth") + 1]).toBe("0.7");
		expect(a[a.indexOf("-et") + 1]).toBe("2.2");
		expect(a[a.indexOf("-lpt") + 1]).toBe("-0.8");
	});

	it("empty language falls back to auto", () => {
		const a = whisperArgs("m", "w", "o", "", THOLDS);
		expect(a[a.indexOf("-l") + 1]).toBe("auto");
	});

	it("the detect pass exits after detecting and keeps its prints", () => {
		const a = detectArgs("tiny.bin", "x.wav");
		expect(a).toContain("-dl");
		expect(a).not.toContain("-np"); // -np would swallow the line we parse
		expect(a[a.indexOf("-m") + 1]).toBe("tiny.bin");
	});
});

describe("parseDetectedLanguage", () => {
	it("reads the code out of whisper's detection line", () => {
		expect(
			parseDetectedLanguage(
				"whisper_full_with_state: auto-detected language: en (p = 0.740969)\n",
			),
		).toBe("en");
	});

	it("returns empty when the line is absent", () => {
		expect(parseDetectedLanguage("whisper_print_timings: total = 5ms")).toBe(
			"",
		);
	});
});

describe("clampLanguage", () => {
	it("leaves the detection alone when no languages are configured", () => {
		expect(clampLanguage("kk", [])).toBe("kk");
	});

	it("keeps a detection that is already configured", () => {
		expect(clampLanguage("ru", ["en", "ru"])).toBe("ru");
	});

	it("snaps a Cyrillic detection to the Cyrillic member", () => {
		for (const detected of ["kk", "uk", "bg", "be", "mk"])
			expect(clampLanguage(detected, ["en", "ru"])).toBe("ru");
	});

	it("snaps a Latin detection to the Latin member", () => {
		expect(clampLanguage("de", ["ru", "en"])).toBe("en");
		expect(clampLanguage("nl", ["ru", "en"])).toBe("en");
	});

	it("falls back to the first entry for an unrelated script", () => {
		expect(clampLanguage("ja", ["en", "ru"])).toBe("en");
		expect(clampLanguage("zh", ["ru", "en"])).toBe("ru");
	});

	it("falls back to the first entry when nothing was detected", () => {
		expect(clampLanguage("", ["ru", "en"])).toBe("ru");
	});
});

describe("wavDurationMs", () => {
	it("reads the duration from the header", () => {
		expect(wavDurationMs(wav(32000))).toBe(1000);
		expect(wavDurationMs(wav(3200))).toBe(100);
	});

	it("trusts the bytes that arrived over a stale declared size", () => {
		const b = wav(32000);
		new DataView(b.buffer).setUint32(40, 0xffffffff, true);
		expect(wavDurationMs(b)).toBe(1000);
	});

	it("gives no opinion on non-wav bytes", () => {
		expect(wavDurationMs(new Uint8Array(200))).toBeUndefined();
		expect(wavDurationMs(new Uint8Array([1, 2, 3]))).toBeUndefined();
	});
});

describe("parseWhisperJson", () => {
	it("folds the transcription segments and reports the language", () => {
		const raw = JSON.stringify({
			result: { language: "en" },
			transcription: [
				{ text: " Hello there" },
				{ text: " friend, how are you?" },
			],
		});
		expect(parseWhisperJson(raw)).toEqual({
			text: "Hello there friend, how are you?",
			language: "en",
		});
	});

	it("returns an empty transcript for malformed JSON", () => {
		expect(parseWhisperJson("{not json")).toEqual({ text: "" });
	});

	it("tolerates missing fields rather than guessing", () => {
		expect(parseWhisperJson("{}")).toEqual({ text: "" });
		expect(
			parseWhisperJson(JSON.stringify({ transcription: [{}, 3] })),
		).toEqual({ text: "" });
		expect(
			parseWhisperJson(JSON.stringify({ transcription: [{ text: "hi" }] })),
		).toEqual({ text: "hi" });
	});

	it("averages the per-token probabilities into a confidence", () => {
		const raw = JSON.stringify({
			transcription: [
				{ text: " hello", tokens: [{ text: " hello", p: 0.9 }] },
				{
					text: " there friend",
					tokens: [
						{ text: " there", p: 0.6 },
						{ text: " friend", p: 0.6 },
					],
				},
			],
		});
		// Weighted by token count, not by segment: (0.9 + 0.6 + 0.6) / 3 = 0.7.
		// A per-segment mean would have said 0.75 and let one stray word carry
		// as much weight as a whole clause.
		expect(parseWhisperJson(raw).confidence).toBeCloseTo(0.7, 10);
	});

	it("leaves whisper's own special tokens out of the mean", () => {
		const raw = JSON.stringify({
			transcription: [
				{
					text: " hello",
					tokens: [
						{ text: "[_BEG_]", p: 0.01 },
						{ text: " hello", p: 0.8 },
						{ text: "[_TT_88]", p: 0.02 },
					],
				},
			],
		});
		// Only the word counts; the bookkeeping tokens describe the decoder's
		// state, not how sure it was of what the owner said.
		expect(parseWhisperJson(raw).confidence).toBeCloseTo(0.8, 10);
	});

	it("reports no confidence at all when there are no tokens to average", () => {
		// Rather than a default: the gate must act on a measurement or on nothing.
		const parsed = parseWhisperJson(
			JSON.stringify({ transcription: [{ text: "hi" }] }),
		);
		expect("confidence" in parsed).toBe(false);
		const noUsable = parseWhisperJson(
			JSON.stringify({
				transcription: [{ text: "hi", tokens: [{ text: "hi", p: "nope" }] }],
			}),
		);
		expect("confidence" in noUsable).toBe(false);
	});

	it("never reports a no-speech probability", () => {
		// whisper-cli emits none under -oj or -ojf; inventing one would make the
		// hallucination gate act on a number nobody measured.
		const parsed = parseWhisperJson(
			JSON.stringify({ transcription: [{ text: "hi" }] }),
		);
		expect("noSpeechProb" in parsed).toBe(false);
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
		config.stt.detectModel = "";
		config.stt.languages = [];
		config.stt.minClipMs = 400;
		return { dir, model };
	}

	const okJson = JSON.stringify({
		result: { language: "en" },
		transcription: [{ text: "  the transcript  " }],
	});

	it("runs ffmpeg then whisper and returns the transcript", async () => {
		const { dir } = withModel();
		const calls: string[][] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push(cmd);
				return { code: 0, stderr: "" };
			},
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		const result = await transcribeLocal(wav(32000), "voice.ogg", deps);
		expect(result.text).toBe("the transcript");
		expect(result.language).toBe("en");
		expect(calls).toHaveLength(2);
		expect(calls[0]?.[0]).toBe("ffmpeg");
		expect(calls[1]?.[0]).toBe("whisper-cli");
		expect(calls[1]).toContain(config.stt.localModel);

		rmSync(dir, { recursive: true, force: true });
	});

	it("carries the decoder's confidence out to the caller", async () => {
		const { dir } = withModel();
		const deps: LocalDeps = {
			run: async () => ({ code: 0, stderr: "" }),
			readOutput: async () =>
				JSON.stringify({
					result: { language: "en" },
					transcription: [
						{
							text: " the transcript",
							tokens: [
								{ text: " the", p: 0.5 },
								{ text: " transcript", p: 0.7 },
							],
						},
					],
				}),
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		const result = await transcribeLocal(wav(32000), "voice.ogg", deps);
		expect(result.text).toBe("the transcript");
		expect(result.confidence).toBeCloseTo(0.6, 10);
		rmSync(dir, { recursive: true, force: true });
	});

	it("leaves confidence unset when whisper reported no tokens", async () => {
		const { dir } = withModel();
		const deps: LocalDeps = {
			run: async () => ({ code: 0, stderr: "" }),
			readOutput: async () => okJson, // segments only, no tokens
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		const result = await transcribeLocal(wav(32000), "voice.ogg", deps);
		expect("confidence" in result).toBe(false);
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
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await transcribeLocal(wav(32000), "clip.wav", deps);
		const input = ffmpeg[ffmpeg.indexOf("-i") + 1];
		const output = ffmpeg.at(-1);
		expect(input).not.toBe(output); // would collide if both were base.wav
		rmSync(dir, { recursive: true, force: true });
	});

	it("refuses a clip shorter than the minimum without spawning anything", async () => {
		const { dir } = withModel();
		config.stt.minClipMs = 400;
		let ran = false;
		const deps: LocalDeps = {
			run: async () => {
				ran = true;
				return { code: 0, stderr: "" };
			},
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		// 3200 bytes at 32 kB/s = 100 ms.
		const result = await transcribeLocal(wav(3200), "blip.wav", deps);
		expect(result.text).toBe("");
		expect(ran).toBe(false);
		rmSync(dir, { recursive: true, force: true });
	});

	it("detects with the small model, clamps, and decodes at a fixed language", async () => {
		const { dir } = withModel();
		config.stt.detectModel = "tiny.bin";
		config.stt.languages = ["en", "ru"];
		const calls: string[][] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push(cmd);
				if (cmd.includes("-dl"))
					return {
						code: 0,
						stderr:
							"whisper_full_with_state: auto-detected language: kk (p = 0.41)\n",
					};
				return { code: 0, stderr: "" };
			},
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};

		await transcribeLocal(wav(64000), "voice.ogg", deps);
		expect(calls).toHaveLength(3); // ffmpeg, detect, decode
		expect(calls[1]).toContain("tiny.bin");
		const decode = calls[2] ?? [];
		expect(decode[decode.indexOf("-l") + 1]).toBe("ru"); // kk snapped to Cyrillic
		expect(decode).not.toContain("auto");
		rmSync(dir, { recursive: true, force: true });
	});

	it("skips detection entirely when STT_LANGUAGE is explicit", async () => {
		const { dir } = withModel();
		config.stt.language = "en";
		config.stt.detectModel = "tiny.bin";
		config.stt.languages = ["ru"];
		const calls: string[][] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push(cmd);
				return { code: 0, stderr: "" };
			},
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await transcribeLocal(wav(64000), "voice.ogg", deps);
		expect(calls).toHaveLength(2);
		const decode = calls[1] ?? [];
		expect(decode[decode.indexOf("-l") + 1]).toBe("en");
		rmSync(dir, { recursive: true, force: true });
	});

	it("falls back to the primary language when the detect pass fails", async () => {
		const { dir } = withModel();
		config.stt.detectModel = "tiny.bin";
		config.stt.languages = ["ru", "en"];
		const calls: string[][] = [];
		const deps: LocalDeps = {
			run: async (cmd) => {
				calls.push(cmd);
				if (cmd.includes("-dl")) return { code: 1, stderr: "boom" };
				return { code: 0, stderr: "" };
			},
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await transcribeLocal(wav(64000), "voice.ogg", deps);
		const decode = calls[2] ?? [];
		expect(decode[decode.indexOf("-l") + 1]).toBe("ru");
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns nothing when whisper's JSON is unreadable", async () => {
		const { dir } = withModel();
		const deps: LocalDeps = {
			run: async () => ({ code: 0, stderr: "" }),
			readOutput: async () => "<not json at all>",
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		const result = await transcribeLocal(wav(32000), "voice.ogg", deps);
		expect(result.text).toBe("");
		expect(result.noSpeechProb).toBeUndefined();
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
			readOutput: async () => okJson,
			cleanup: () => {},
			tmpBase: () => join(dir, "base"),
		};
		await expect(transcribeLocal(wav(32000), "v.ogg", deps)).rejects.toThrow(
			/ffmpeg failed/,
		);
		rmSync(dir, { recursive: true, force: true });
	});
});
