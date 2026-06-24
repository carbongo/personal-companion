/**
 * HTTP entry point. A single long-lived Bun process serves the web interface
 * (setup wizard + built-in chat + memory admin), runs the Telegram channel,
 * and — in a later phase — the nightly memory roll-up, all in the same process.
 *
 * Importing the db here applies migrations on boot. The engine is reachable from
 * a terminal (`bun run chat`), over Telegram, and through the web interface and
 * its JSON API (mounted by `mountWeb`). See docs/architecture.md.
 */
import { Hono } from "hono";

import {
	startTelegram,
	telegramConfigured,
} from "#/channels/telegram/index.ts";
import { config } from "#/config/index.ts";
import "#/db/index.ts"; // open + migrate the database on boot
import { provider } from "#/llm/index.ts";
import { webAuthEnabled } from "#/server/web/auth.ts";
import { mountWeb } from "#/server/web/index.tsx";
import { isSetupComplete } from "#/server/web/setup-state.ts";

const app = new Hono();

app.get("/health", (c) =>
	c.json({ status: "ok", name: config.app.name, version: "0.0.1" }),
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

mountWeb(app);
console.log(
	`[companion] Web interface: enabled (auth ${webAuthEnabled() ? "on" : "off"}` +
		`${isSetupComplete() ? "" : ", first-run setup pending"})`,
);

const port = config.app.port;
console.log(`[companion] listening on http://localhost:${port}`);

export default {
	fetch: app.fetch,
	port,
};
