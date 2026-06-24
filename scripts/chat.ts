#!/usr/bin/env bun

// Terminal REPL to talk to the companion engine without a channel. Useful for
// verifying Phase 1 against a real model: reads lines from stdin, runs each
// through engine.respond, and prints the reply. Ctrl+C or /exit to quit.

import { respond } from "#/companion-core/engine.ts";
import { config } from "#/config/index.ts";
import "#/db/index.ts";
import { provider } from "#/llm/index.ts";

const brain = provider.describe();
console.log(
	`Talking to "${config.app.name}" — brain: ${brain.provider}/${brain.model}` +
		(brain.endpoint ? ` @ ${brain.endpoint}` : ""),
);
console.log("Type a message. /exit to quit.\n");

for await (const line of console) {
	const text = line.trim();
	if (!text) continue;
	if (text === "/exit" || text === "/quit") break;
	try {
		const { reply } = await respond({ text });
		console.log(`\n${config.app.name}: ${reply}\n`);
	} catch (err) {
		console.error("error:", (err as Error).message);
	}
}
