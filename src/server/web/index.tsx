/**
 * The web interface, assembled onto the main Hono app: auth gating, the static
 * assets, the login flow, the pages, and the JSON API. One function —
 * `mountWeb(app)` — wires it all so src/server/index.ts stays a thin entry
 * point. See docs/channels.md and docs/architecture.md.
 *
 * The premium client is a built single-page app (see web/, the Nocturne
 * design system). When `web/dist` is present we serve that SPA; if it hasn't
 * been built, we fall back to the original server-rendered pages so the app
 * still works from a bare `bun start`. Build the SPA with `bun run web:build`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { contentTypeFor, resolveUpload } from "#/companion-core/media.ts";
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

// Resolve the built client relative to this file, so it's found no matter the
// process cwd (launchd, Docker, a git worktree…).
const DIST = join(import.meta.dir, "../../../web/dist");
const SPA_INDEX = join(DIST, "index.html");
const hasSpa = existsSync(SPA_INDEX);

export function mountWeb(app: Hono): void {
	const authEnabled = webAuthEnabled();
	const name = config.app.name;

	// Gate everything (no-op when WEB_AUTH_PASSWORD is unset).
	app.use("*", requireAuth);

	if (hasSpa) {
		// Built SPA assets — content-hashed filenames, so they cache forever.
		app.get("/assets/:file", (c) => {
			const file = c.req.param("file");
			if (file.includes("..")) return c.notFound();
			const path = join(DIST, "assets", file);
			if (!existsSync(path)) return c.notFound();
			return new Response(Bun.file(path), {
				headers: { "cache-control": "public, max-age=31536000, immutable" },
			});
		});
	} else {
		// Original assets (one stylesheet + small page scripts), served `no-cache`
		// so a revalidate happens every load — they're tiny and ship in the app.
		app.get("/assets/:file", (c) => {
			const asset = ASSETS[c.req.param("file")];
			if (!asset) return c.notFound();
			const [bodyText, type] = asset;
			return c.body(bodyText, 200, {
				"content-type": type,
				"cache-control": "no-cache",
			});
		});
	}

	// Saved attachments (chat images). Behind the same auth as everything else,
	// so private images aren't world-readable. Filenames are unique, so they can
	// be cached hard. Path traversal is refused in resolveUpload.
	app.get("/uploads/:file", (c) => {
		const path = resolveUpload(c.req.param("file"));
		if (!path) return c.notFound();
		return new Response(Bun.file(path), {
			headers: {
				"content-type": contentTypeFor(path),
				"cache-control": "private, max-age=31536000, immutable",
			},
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
	if (hasSpa) {
		// Serve the SPA shell. The client owns its own routing (chat ⇄ settings)
		// and steers first-run users to the Slate to attune a model, so the old
		// /setup and /memory URLs just deep-link into the new settings menu.
		const shell = () =>
			new Response(Bun.file(SPA_INDEX), {
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-cache",
				},
			});
		app.get("/", () => shell());
		app.get("/setup", (c) => c.redirect("/#/settings"));
		app.get("/memory", (c) => c.redirect("/#/settings"));
	} else {
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
	}

	// JSON API.
	app.route("/api", api);
}
