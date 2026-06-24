/**
 * Server-rendered pages (Hono JSX, no build step). Each page is a static shell;
 * the interactivity lives in the small scripts served from ./assets.ts and
 * talks to the JSON API in ./api.ts. See docs/channels.md (built-in web chat)
 * and docs/tech-stack.md (why server-rendered, no SPA bundler).
 */
import { raw } from "hono/html";
import type { PropsWithChildren } from "hono/jsx";

import type { ProviderInfo } from "#/llm/types.ts";
import type { SetupValues } from "./setup-state.ts";

interface LayoutProps {
	title: string;
	name: string;
	active: "chat" | "memory" | "setup" | "";
	authEnabled: boolean;
	bare?: boolean;
}

const NAV: Array<{ href: string; key: LayoutProps["active"]; label: string }> =
	[
		{ href: "/", key: "chat", label: "Chat" },
		{ href: "/memory", key: "memory", label: "Memory" },
		{ href: "/setup", key: "setup", label: "Setup" },
	];

export const Layout = (props: PropsWithChildren<LayoutProps>) => (
	<>
		{raw("<!DOCTYPE html>")}
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="color-scheme" content="dark light" />
				<title>{props.title}</title>
				<link rel="stylesheet" href="/assets/app.css" />
			</head>
			<body>
				{!props.bare && (
					<header class="bar">
						<div class="wrap">
							<span class="name">{props.name}</span>
							<nav>
								{NAV.map((n) => (
									<a
										href={n.href}
										class={n.key === props.active ? "active" : ""}
									>
										{n.label}
									</a>
								))}
								{props.authEnabled && <a href="/logout">Sign out</a>}
							</nav>
						</div>
					</header>
				)}
				<main>
					<div class="wrap">{props.children}</div>
				</main>
			</body>
		</html>
	</>
);

export const ChatPage = (props: {
	name: string;
	brain: ProviderInfo;
	authEnabled: boolean;
}) => (
	<Layout
		title={props.name}
		name={props.name}
		active="chat"
		authEnabled={props.authEnabled}
	>
		<div class="chat">
			<div class="sub">
				Talking to {props.name} — {props.brain.provider}/{props.brain.model}
			</div>
			<div class="msgs" id="msgs" />
			<div class="composer">
				<textarea id="text" placeholder="Message…" rows={1} />
				<button type="button" id="send">
					Send
				</button>
			</div>
		</div>
		<script src="/assets/chat.js" />
	</Layout>
);

export const MemoryPage = (props: { name: string; authEnabled: boolean }) => (
	<Layout
		title={`${props.name} — Memory`}
		name={props.name}
		active="memory"
		authEnabled={props.authEnabled}
	>
		<h1>Memory</h1>
		<p class="sub">
			The companion's persistent memory — read it, shape it, or fold today in
			early.
		</p>

		<h2>Core</h2>
		<div class="card">
			<p class="sub">
				The living spine of who you two are. Edited here, read every turn.
			</p>
			<div class="row tabs">
				<button type="button" id="coreEditTab" class="tab on">
					Edit
				</button>
				<button type="button" id="corePreviewTab" class="tab">
					Preview
				</button>
			</div>
			<textarea id="core" rows={10} placeholder="The Core is empty." />
			<div id="corePreview" class="md hidden" />
			<div class="row" style="margin-top:10px">
				<button type="button" id="saveCore">
					Save Core
				</button>
			</div>
			<div id="coreNote" class="note hidden" />
		</div>

		<h2>Saved memories</h2>
		<div class="card">
			<input type="text" id="memSearch" placeholder="Search memories…" />
			<div id="memList" style="margin-top:6px" />
			<label for="memInput">Add a memory</label>
			<textarea id="memInput" rows={2} placeholder="A fact worth keeping…" />
			<div class="row" style="margin-top:8px">
				<input
					type="text"
					id="memTags"
					placeholder="tags (optional)"
					style="max-width:240px"
				/>
				<button type="button" id="addMem">
					Add
				</button>
			</div>
		</div>

		<h2>Daily summaries</h2>
		<div class="card">
			<div class="row">
				<button type="button" id="runRollup" class="ghost">
					Run roll-up now
				</button>
				<span class="sub">Compresses today and backfills any missed day.</span>
			</div>
			<div id="rollupNote" class="note hidden" />
			<div id="sumList" style="margin-top:6px" />
		</div>
		<script src="/assets/admin.js" />
	</Layout>
);

const PRESETS: Array<{ id: string; label: string; blurb: string }> = [
	{
		id: "companion",
		label: "Companion",
		blurb: "Warm, steady, genuinely interested",
	},
	{ id: "sage", label: "Sage", blurb: "Calm, curious mentor" },
	{ id: "pip", label: "Pip", blurb: "Upbeat, encouraging friend" },
	{ id: "coach", label: "Coach", blurb: "Blunt, supportive, accountable" },
];

export const SetupPage = (props: {
	name: string;
	authEnabled: boolean;
	values: SetupValues;
	complete: boolean;
}) => {
	const v = props.values;
	const ollama =
		v.provider !== "openai-compatible" && v.provider !== "anthropic";
	return (
		<Layout
			title={`${props.name} — Setup`}
			name={props.name}
			active="setup"
			authEnabled={props.authEnabled}
		>
			<h1>
				{props.complete ? "Settings" : "Welcome — let's set up your companion"}
			</h1>
			<p class="sub">
				Persona and facts apply immediately. Model, name, and channel changes
				are saved to your
				<code> .env</code> and take effect after a restart.
			</p>

			<h2>Identity</h2>
			<div class="card">
				<label for="name">What is your companion called?</label>
				<input type="text" id="name" value={v.name} placeholder="Companion" />
				<label for="owner">What should it call you?</label>
				<input type="text" id="owner" value={v.owner} placeholder="friend" />

				<p class="caption">Starting personality (preset)</p>
				{PRESETS.map((p) => (
					<label class="row" style="margin:4px 0">
						<input
							type="radio"
							name="preset"
							value={p.id}
							checked={v.preset === p.id}
							style="width:auto"
						/>
						<span>
							<strong>{p.label}</strong> <span class="sub">— {p.blurb}</span>
						</span>
					</label>
				))}

				<label for="persona">
					Custom persona (optional — overrides the preset)
				</label>
				<textarea
					id="persona"
					rows={10}
					placeholder="Describe who your companion is, in your own words…"
				>
					{v.persona}
				</textarea>

				<label for="coreSeed">
					A few facts about you to start from (optional)
				</label>
				<textarea
					id="coreSeed"
					rows={4}
					placeholder="What your companion should know about you from day one…"
				/>
			</div>

			<h2>Model</h2>
			<div class="card">
				<label for="provider">Provider</label>
				<select id="provider">
					<option value="ollama" selected={ollama}>
						Ollama (local, default)
					</option>
					<option
						value="openai-compatible"
						selected={v.provider === "openai-compatible"}
					>
						OpenAI-compatible (hosted)
					</option>
				</select>

				<label for="model">Model</label>
				<input
					type="text"
					id="model"
					value={v.model}
					placeholder="gemma4:12b"
				/>

				<div id="ollamaRow" class={ollama ? "" : "hidden"}>
					<label for="ollamaUrl">Ollama URL</label>
					<input
						type="text"
						id="ollamaUrl"
						value={v.ollamaUrl}
						placeholder="http://localhost:11434"
					/>
				</div>

				<div id="hostedRows" class={ollama ? "hidden" : ""}>
					<label for="baseUrl">Base URL</label>
					<input
						type="text"
						id="baseUrl"
						value={v.baseUrl}
						placeholder="https://api.openai.com/v1"
					/>
					<label for="apiKey">API key</label>
					<input
						type="password"
						id="apiKey"
						placeholder={"•".repeat(12)}
						autocomplete="off"
					/>
				</div>

				<div class="row" style="margin-top:12px">
					<button type="button" id="test" class="ghost">
						Test connection
					</button>
				</div>
				<div id="testNote" class="note hidden" />
			</div>

			<h2>Telegram (optional)</h2>
			<div class="card">
				<p class="sub">
					Leave blank to skip.{" "}
					{v.telegramConfigured
						? "A token is already set; entering a new one replaces it."
						: "Get a token from @BotFather."}
				</p>
				<label for="telegramToken">Bot token</label>
				<input
					type="password"
					id="telegramToken"
					placeholder="123456:ABC-…"
					autocomplete="off"
				/>
				<label for="telegramAllowedIds">
					Allowed Telegram user IDs (comma-separated)
				</label>
				<input
					type="text"
					id="telegramAllowedIds"
					value={v.telegramAllowedIds}
					placeholder="e.g. 12345678"
				/>
			</div>

			<div class="row" style="margin-top:18px">
				<button type="button" id="save">
					{props.complete ? "Save settings" : "Finish setup"}
				</button>
			</div>
			<div id="saveNote" class="note hidden" />
			<script src="/assets/setup.js" />
		</Layout>
	);
};

export const LoginPage = (props: { name: string; error?: boolean }) => (
	<Layout
		title={`${props.name} — Sign in`}
		name={props.name}
		active=""
		authEnabled
		bare
	>
		<div style="max-width:360px;margin:14vh auto 0">
			<h1>{props.name}</h1>
			<p class="sub">This companion is password-protected.</p>
			<form method="post" action="/login" class="card">
				<label for="password">Password</label>
				<input
					type="password"
					id="password"
					name="password"
					autofocus
					autocomplete="current-password"
				/>
				{props.error && <div class="note bad">Wrong password.</div>}
				<div class="row" style="margin-top:14px">
					<button type="submit">Sign in</button>
				</div>
			</form>
		</div>
	</Layout>
);
