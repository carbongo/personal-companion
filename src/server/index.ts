/**
 * HTTP entry point. A single long-lived Bun process serves the web interface
 * (admin + built-in chat), runs the Telegram channel, and — in a later phase —
 * the nightly memory roll-up, all in the same process.
 *
 * Importing the db here applies migrations on boot. The engine is reachable from
 * a terminal (`bun run chat`) and over Telegram (Phase 2); the web chat/admin
 * SPA and the JSON API mount here in Phase 3 (see docs/roadmap.md).
 */
import { Hono } from "hono";

import {
	startTelegram,
	telegramConfigured,
} from "#/channels/telegram/index.ts";
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

if (telegramConfigured()) {
	console.log("[companion] Telegram channel: enabled");
	startTelegram();
} else {
	console.log("[companion] Telegram channel: disabled (no TELEGRAM_BOT_TOKEN)");
}

const port = config.app.port;
console.log(`[companion] listening on http://localhost:${port}`);

export default {
	fetch: app.fetch,
	port,
};
