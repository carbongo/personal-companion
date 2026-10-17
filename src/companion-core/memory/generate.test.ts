import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { config } from "#/config/index.ts";
import { provider } from "#/llm/index.ts";
import { memoryChat } from "./generate.ts";

const prev = config.memory.model;
afterEach(() => {
	config.memory.model = prev;
});

describe("memoryChat", () => {
	it("runs memory upkeep on MEMORY_MODEL when it is set", async () => {
		config.memory.model = "small-model";
		const chat = spyOn(provider, "chat").mockResolvedValue("ok");
		await memoryChat([], { think: false });
		expect(chat.mock.calls.at(-1)?.[1]).toEqual({
			think: false,
			model: "small-model",
		});
	});

	it("leaves the conversation's model alone when it is not", async () => {
		config.memory.model = "";
		const chat = spyOn(provider, "chat").mockResolvedValue("ok");
		await memoryChat([], { think: false });
		expect(chat.mock.calls.at(-1)?.[1]).toEqual({ think: false });
	});
});
