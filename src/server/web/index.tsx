/**
 * The web interface, assembled onto the main Hono app: auth gating, the static
 * assets, the login flow, the server-rendered pages, and the JSON API. One
 * function — `mountWeb(app)` — wires it all so src/server/index.ts stays a thin
 * entry point. See docs/channels.md and docs/architecture.md.
 */
import type { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import { config } from "#/config/index.ts";
import { provider } from "#/llm/index.ts";
import { api } from "./api.ts";
import { ASSETS } from "./assets.ts";
import {
	requireAuth,
	SESSION_COOKIE,
	SESSION_MAX_AGE,
	sessionToken,
	verifyPassword,
	webAuthEnabled,
} from "./auth.ts";
import { ChatPage, LoginPage, MemoryPage, SetupPage } from "./pages.tsx";
import { currentSetupValues, isSetupComplete } from "./setup-state.ts";

export function mountWeb(app: Hono): void {
	const authEnabled = webAuthEnabled();
	const name = config.app.name;

	// Gate everything (no-op when WEB_AUTH_PASSWORD is unset).
	app.use("*", requireAuth);

	// Static assets (one stylesheet + the small page scripts), cached.
	app.get("/assets/:file", (c) => {
		const asset = ASSETS[c.req.param("file")];
		if (!asset) return c.notFound();
		const [bodyText, type] = asset;
		return c.body(bodyText, 200, {
			"content-type": type,
			"cache-control": "public, max-age=3600",
		});
	});

	// Login flow (only meaningful when a password is set).
	app.get("/login", (c) => {
		if (!authEnabled) return c.redirect("/");
		return c.html(<LoginPage name={name} error={c.req.query("e") === "1"} />);
	});
	app.post("/login", async (c) => {
		const form = await c.req.parseBody();
		if (verifyPassword(String(form.password ?? ""))) {
			setCookie(c, SESSION_COOKIE, sessionToken(config.app.webAuthPassword), {
				httpOnly: true,
				sameSite: "Lax",
				path: "/",
				maxAge: SESSION_MAX_AGE,
			});
			return c.redirect("/");
		}
		return c.redirect("/login?e=1");
	});
	app.get("/logout", (c) => {
		deleteCookie(c, SESSION_COOKIE, { path: "/" });
		return c.redirect(authEnabled ? "/login" : "/");
	});

	// Pages.
	app.get("/", (c) => {
		if (!isSetupComplete()) return c.redirect("/setup");
		return c.html(
			<ChatPage
				name={name}
				brain={provider.describe()}
				authEnabled={authEnabled}
			/>,
		);
	});
	app.get("/memory", (c) =>
		c.html(<MemoryPage name={name} authEnabled={authEnabled} />),
	);
	app.get("/setup", (c) =>
		c.html(
			<SetupPage
				name={name}
				authEnabled={authEnabled}
				values={currentSetupValues()}
				complete={isSetupComplete()}
			/>,
		),
	);

	// JSON API.
	app.route("/api", api);
}
