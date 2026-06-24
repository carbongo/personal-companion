/**
 * Configuration loading. Everything the app needs comes from the environment
 * (see `.env.example` for the full reference). This module is the single place
 * env is read, so the rest of the code takes a typed `config` object and never
 * touches `process.env` directly.
 *
 * Phase 0 only loads the `app` section (enough to boot the server). Later phases
 * add `llm`, `telegram`, `memory`, `web`, and `stt` sections here as they land
 * — see docs/configuration.md.
 */

function str(key: string, fallback: string): string {
	const v = process.env[key];
	return v == null || v === "" ? fallback : v;
}

function num(key: string, fallback: number): number {
	const v = process.env[key];
	if (v == null || v === "") return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
	/** Display name the companion goes by (feeds the persona). */
	name: string;
	/** What the companion calls the owner. */
	owner: string;
	/** IANA timezone for day-bucketing, summaries, and the date it sees. */
	timezone: string;
	/** Directory holding the SQLite database and uploads. */
	dataDir: string;
	/** Port for the web interface. */
	port: number;
	/** Web UI password; empty means no app-level auth (rely on a trusted network). */
	webAuthPassword: string;
}

export interface Config {
	app: AppConfig;
}

export function loadConfig(): Config {
	return {
		app: {
			name: str("COMPANION_NAME", "Companion"),
			owner: str("COMPANION_OWNER", "friend"),
			timezone: str("TZ", "UTC"),
			dataDir: str("DATA_DIR", "./data"),
			port: num("PORT", 8080),
			webAuthPassword: str("WEB_AUTH_PASSWORD", ""),
		},
	};
}

export const config: Config = loadConfig();
