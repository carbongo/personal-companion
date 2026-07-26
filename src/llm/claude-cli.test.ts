import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config } from "#/config/index.ts";
import { buildPrompt, ClaudeCliProvider, mediaTypeOf } from "./claude-cli.ts";

describe("buildPrompt", () => {
	it("joins system messages and keeps the latest user turn last", () => {
		const { system, text } = buildPrompt([
			{ role: "system", content: "You are Sage." },
			{ role: "system", content: "Today is Tuesday." },
			{ role: "user", content: "my dog is Rex" },
			{ role: "assistant", content: "Good name." },
			{ role: "user", content: "what's his name?" },
		]);
		expect(system).toBe("You are Sage.\n\nToday is Tuesday.");
		expect(text).toContain("User: my dog is Rex");
		expect(text).toContain("Assistant: Good name.");
		// The new message comes after the transcript, unlabelled.
		expect(text.endsWith("what's his name?")).toBe(true);
		expect(text).not.toContain("User: what's his name?");
	});

	it("sends a lone user turn with no transcript preamble", () => {
		const { text } = buildPrompt([
			{ role: "system", content: "You are Sage." },
			{ role: "user", content: "hey" },
		]);
		expect(text).toBe("hey");
	});

	it("carries the latest turn's images", () => {
		const { images } = buildPrompt([
			{ role: "user", content: "old" },
			{ role: "user", content: "look", images: ["aGk="] },
		]);
		expect(images).toEqual(["aGk="]);
	});
});

describe("mediaTypeOf", () => {
	it("sniffs png, gif and webp, defaulting to jpeg", () => {
		expect(mediaTypeOf("iVBORw0KGgoAAA")).toBe("image/png");
		expect(mediaTypeOf("R0lGODlhAQ")).toBe("image/gif");
		expect(mediaTypeOf("UklGRiQA")).toBe("image/webp");
		expect(mediaTypeOf("/9j/4AAQSkZJRg")).toBe("image/jpeg");
	});
});

/**
 * A stand-in for the real `claude`: records its argv and stdin, then replays a
 * plausible NDJSON stream. Lets the whole spawn/parse path run in tests without
 * touching the network.
 */
let dir: string;
let bin: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "claude-cli-test-"));
	bin = join(dir, "fake-claude");
	await Bun.write(
		bin,
		`#!/usr/bin/env bash
printf '%s\\n' "$@" > "${dir}/argv.txt"
cat > "${dir}/stdin.txt"
if [ "$1" = "--version" ]; then echo "0.0.0 (fake)"; exit 0; fi
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"all "}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"good"}}}'
echo 'not json at all'
echo '{"type":"result","subtype":"success","is_error":false,"result":"all good"}'
`,
	);
	await Bun.spawn(["chmod", "+x", bin]).exited;
});

afterAll(async () => {
	await Bun.spawn(["rm", "-rf", dir]).exited;
});

function provider(over: Partial<typeof config.llm> = {}): ClaudeCliProvider {
	return new ClaudeCliProvider({
		...config.llm,
		provider: "claude-cli",
		model: "haiku",
		think: "medium",
		claudeBin: bin,
		...over,
	});
}

const argv = async (): Promise<string[]> =>
	(await Bun.file(join(dir, "argv.txt")).text()).trim().split("\n");

describe("ClaudeCliProvider", () => {
	it("returns the result line, ignoring thinking and stray output", async () => {
		expect(await provider().chat([{ role: "user", content: "hi" }])).toBe(
			"all good",
		);
	});

	it("strips the CLI down to a plain chat model", async () => {
		await provider().chat([{ role: "user", content: "hi" }]);
		const a = await argv();
		expect(a).toContain("--print");
		expect(a).toContain("--strict-mcp-config");
		expect(a).toContain("--no-session-persistence");
		// --tools and --setting-sources are both passed an empty value.
		expect(a[a.indexOf("--tools") + 1]).toBe("");
		expect(a[a.indexOf("--setting-sources") + 1]).toBe("");
	});

	it("passes the model and maps LLM_THINK to --effort", async () => {
		await provider().chat([{ role: "user", content: "hi" }]);
		let a = await argv();
		expect(a[a.indexOf("--model") + 1]).toBe("haiku");
		expect(a[a.indexOf("--effort") + 1]).toBe("medium");

		await provider({ think: "true" }).chat([{ role: "user", content: "hi" }]);
		a = await argv();
		expect(a[a.indexOf("--effort") + 1]).toBe("medium");

		await provider({ think: "false" }).chat([{ role: "user", content: "hi" }]);
		a = await argv();
		expect(a[a.indexOf("--effort") + 1]).toBe("low");

		await provider().chat([{ role: "user", content: "hi" }], {
			think: "xhigh",
		});
		a = await argv();
		expect(a[a.indexOf("--effort") + 1]).toBe("xhigh");
	});

	it("passes the system prompt and sends one user message on stdin", async () => {
		await provider().chat([
			{ role: "system", content: "You are Sage." },
			{ role: "user", content: "hi" },
		]);
		const a = await argv();
		expect(a[a.indexOf("--system-prompt") + 1]).toBe("You are Sage.");

		const lines = (await Bun.file(join(dir, "stdin.txt")).text())
			.trim()
			.split("\n");
		expect(lines).toHaveLength(1);
		const msg = JSON.parse(lines[0] ?? "") as {
			type: string;
			message: {
				role: string;
				content: Array<{ type: string; text?: string }>;
			};
		};
		expect(msg.type).toBe("user");
		expect(msg.message.content).toEqual([{ type: "text", text: "hi" }]);
	});

	it("sends images ahead of the text, with a sniffed media type", async () => {
		await provider().chat([
			{ role: "user", content: "what is this", images: ["iVBORw0KGgoAAA"] },
		]);
		const msg = JSON.parse(
			(await Bun.file(join(dir, "stdin.txt")).text()).trim(),
		) as { message: { content: Array<Record<string, unknown>> } };
		expect(msg.message.content[0]).toEqual({
			type: "image",
			source: {
				type: "base64",
				media_type: "image/png",
				data: "iVBORw0KGgoAAA",
			},
		});
		expect(msg.message.content[1]?.type).toBe("text");
	});

	it("streams text deltas and skips thinking deltas", async () => {
		const seen: string[] = [];
		const full = await provider().chatStream(
			[{ role: "user", content: "hi" }],
			(t) => {
				seen.push(t);
			},
		);
		expect(seen).toEqual(["all ", "good"]);
		expect(full).toBe("all good");
		expect(await argv()).toContain("--include-partial-messages");
	});

	it("refuses an Ollama-style model tag with a clear message", () => {
		expect(() => provider({ model: "gemma4:12b" }).describe()).toThrow(
			/not a Claude model/,
		);
	});

	it("reports reachable when the binary runs, unreachable when it doesn't", async () => {
		expect(await provider().reachable()).toBe(true);
		expect(await provider({ claudeBin: join(dir, "nope") }).reachable()).toBe(
			false,
		);
	});
});
