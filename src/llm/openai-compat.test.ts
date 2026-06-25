import { afterEach, describe, expect, it } from "bun:test";

import { config } from "#/config/index.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";

const original = { ...config.llm };
const realFetch = globalThis.fetch;
afterEach(() => {
	Object.assign(config.llm, original);
	globalThis.fetch = realFetch;
});

/** Capture the JSON body of the next chat/completions POST. */
function captureBody(): { get: () => Record<string, unknown> } {
	let body: Record<string, unknown> = {};
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		body = JSON.parse(String(init.body));
		return new Response(
			JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}) as unknown as typeof fetch;
	return { get: () => body };
}

function provider(think: string): OpenAICompatProvider {
	return new OpenAICompatProvider({
		...config.llm,
		provider: "openai-compatible",
		baseUrl: "https://example.test/v1",
		apiKey: "k",
		think,
	});
}

describe("OpenAICompatProvider reasoning_effort", () => {
	it("sends reasoning_effort for an effort level", async () => {
		const cap = captureBody();
		await provider("high").chat([{ role: "user", content: "hi" }]);
		expect(cap.get().reasoning_effort).toBe("high");
	});

	it("omits reasoning_effort for true/false (endpoint default)", async () => {
		let cap = captureBody();
		await provider("true").chat([{ role: "user", content: "hi" }]);
		expect("reasoning_effort" in cap.get()).toBe(false);

		cap = captureBody();
		await provider("false").chat([{ role: "user", content: "hi" }]);
		expect("reasoning_effort" in cap.get()).toBe(false);
	});

	it("lets a per-call think override the configured value", async () => {
		const cap = captureBody();
		await provider("true").chat([{ role: "user", content: "hi" }], {
			think: "low",
		});
		expect(cap.get().reasoning_effort).toBe("low");
	});
});
