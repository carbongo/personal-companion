/**
 * HTTP entry point. A single long-lived Bun process serves the web interface
 * (admin + built-in chat) and — in later phases — runs the Telegram channel and
 * the nightly memory roll-up in the same process.
 *
 * Importing the db here applies migrations on boot. Phase 1: the engine exists
 * and is reachable from a terminal (`bun run chat`); the web chat/admin SPA and
 * the JSON API mount here in Phase 3 (see docs/roadmap.md).
 */
import { Hono } from "hono";

import { config } from "#/config/index.ts";
import "#/db/index.ts"; // open + migrate the database on boot
import { provider } from "#/llm/index.ts";

const app = new Hono();

app.get("/health", (c) =>
	c.json({ status: "ok", name: config.app.name, version: "0.0.1" }),
);

app.get("/", (c) =>
	c.text(
		`${config.app.name} is running.\n` +
			"Web interface (setup, chat, memory admin) arrives in Phase 3.\n" +
			"Talk to the engine now with: bun run chat\n" +
			"See https://github.com/carbongo/personal-companion",
	),
);

const brain = provider.describe();
console.log(
	`[companion] "${config.app.name}" — brain: ${brain.provider}/${brain.model}` +
		(brain.endpoint ? ` @ ${brain.endpoint}` : ""),
);

const port = config.app.port;
console.log(`[companion] listening on http://localhost:${port}`);

export default {
	fetch: app.fetch,
	port,
};
