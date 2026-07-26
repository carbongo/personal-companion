import { afterEach, describe, expect, it } from "bun:test";

import { config } from "#/config/index.ts";
import { companionConfigured } from "./engine.ts";

const original = { ...config.llm };

afterEach(() => {
	Object.assign(config.llm, original);
});

describe("companionConfigured", () => {
	it("asks for an Ollama URL when the provider is ollama", () => {
		Object.assign(config.llm, {
			provider: "ollama",
			ollamaUrl: "http://127.0.0.1:11434",
		});
		expect(companionConfigured()).toBe(true);

		config.llm.ollamaUrl = "";
		expect(companionConfigured()).toBe(false);
	});

	it("asks for a base URL when the provider talks HTTP", () => {
		Object.assign(config.llm, {
			provider: "openai-compatible",
			baseUrl: "http://127.0.0.1:8000/v1",
		});
		expect(companionConfigured()).toBe(true);

		config.llm.baseUrl = "";
		expect(companionConfigured()).toBe(false);
	});

	// claude-cli is configured by a binary, not an endpoint. Falling through to
	// the base-URL check left it reading as unconfigured, which silently turned
	// off the roll-up scheduler and made the web chat answer 503.
	it("asks for the binary when the provider is claude-cli", () => {
		Object.assign(config.llm, {
			provider: "claude-cli",
			baseUrl: "",
			ollamaUrl: "",
			claudeBin: "claude",
		});
		expect(companionConfigured()).toBe(true);

		config.llm.claudeBin = "";
		expect(companionConfigured()).toBe(false);
	});
});
