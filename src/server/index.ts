/**
 * HTTP entry point. A single long-lived Bun process serves the web interface
 * (setup wizard + built-in chat + memory admin), runs the Telegram channel, and
 * drives the nightly memory roll-up, all in the same process.
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
import { companionConfigured } from "#/companion-core/engine.ts";
import {
	backfillPastDays,
	runDailyRollup,
} from "#/companion-core/memory/rollup.ts";
import { RollupScheduler } from "#/companion-core/memory/scheduler.ts";
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

// Nightly roll-up — driven in-process so it needs no external cron, and resilient
// to the box being off at the scheduled minute: it catches up missed days on boot
// and on a periodic safety tick. No-op while no model is configured.
if (companionConfigured()) {
	const scheduler = new RollupScheduler({
		cron: config.memory.summaryCron,
		tz: config.app.timezone,
		runDailyRollup,
		backfillPastDays,
		log: (m) => console.log(m),
	});
	void scheduler.boot();
	scheduler.start();
	console.log(
		`[companion] roll-up scheduler: on (cron "${config.memory.summaryCron}", ${config.app.timezone}; catches up on boot)`,
	);
} else {
	console.log("[companion] roll-up scheduler: off (no model configured)");
}

const port = config.app.port;
console.log(`[companion] listening on http://localhost:${port}`);

export default {
	fetch: app.fetch,
	port,
	// Streamed chat replies can sit silent for many seconds while the model
	// "thinks" before any token lands. Bun's default idle timeout (~10s) would
	// drop that connection mid-think. Raise it (the streaming handler also sends
	// keepalive pings); generation itself is bounded by LLM_TIMEOUT_MS. Max 255s.
	idleTimeout: 255,
};
