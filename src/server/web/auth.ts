/**
 * Web auth. When `WEB_AUTH_PASSWORD` is set, the whole interface (pages + API)
 * sits behind a single shared password; a successful login sets a signed
 * session cookie. When it is empty, there is no app-level auth — appropriate
 * only on a trusted network (a tailnet, localhost). See docs/security.md and
 * docs/decisions/local-first-default-and-web-auth.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { config } from "#/config/index.ts";

export const SESSION_COOKIE = "companion_session";
/** 30 days; the owner is a single person on their own box. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** True when a password is configured and the interface should be gated. */
export function webAuthEnabled(): boolean {
	return !!config.app.webAuthPassword;
}

/**
 * The opaque cookie value for a password. It is derived (not the password
 * itself) so the secret never travels in the cookie, and it changes if the
 * password changes — rotating the password invalidates old sessions.
 */
export function sessionToken(password: string): string {
	return createHmac("sha256", password)
		.update("personal-companion/session/v1")
		.digest("hex");
}

/** Constant-time check that a presented cookie matches the current password. */
export function isValidSession(token: string | undefined): boolean {
	return constantTimeEquals(token, sessionToken(config.app.webAuthPassword));
}

/** Constant-time check of a submitted login password against the configured one. */
export function verifyPassword(input: string): boolean {
	if (!config.app.webAuthPassword) return false;
	return constantTimeEquals(input, config.app.webAuthPassword);
}

function constantTimeEquals(a: string | undefined, b: string): boolean {
	if (!a || a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const OPEN_PATHS = new Set(["/login", "/logout", "/health"]);

/**
 * Gate everything except the login/health endpoints and static assets. Pages
 * redirect to /login; the JSON API answers 401 so the browser fetch can react.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
	if (!webAuthEnabled()) return next();

	const path = c.req.path;
	if (OPEN_PATHS.has(path) || path.startsWith("/assets/")) return next();

	if (isValidSession(getCookie(c, SESSION_COOKIE))) return next();

	if (path.startsWith("/api/")) return c.json({ error: "unauthorized" }, 401);
	return c.redirect("/login");
};
