/**
 * HTTP entry point. A single long-lived Bun process serves the web interface
 * (admin + built-in chat) and — in later phases — runs the Telegram channel and
 * the nightly memory roll-up in the same process.
 *
 * Phase 0: boots Hono with a health check and a placeholder root. The chat/admin
 * SPA (web/) and the JSON API mount here in Phase 3 (see docs/roadmap.md).
 */
import { Hono } from "hono";

import { config } from "#/config/index.ts";

const app = new Hono();

app.get("/health", (c) =>
	c.json({ status: "ok", name: config.app.name, version: "0.0.1" }),
);

app.get("/", (c) =>
	c.text(
		`${config.app.name} is running.\n` +
			"Web interface (setup, chat, memory admin) arrives in Phase 3.\n" +
			"See https://github.com/carbongo/personal-companion",
	),
);

const port = config.app.port;
console.log(`[companion] listening on http://localhost:${port}`);

export default {
	fetch: app.fetch,
	port,
};
