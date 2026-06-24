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
		{ href: "/setup", key: "setup", label: "Settings" },
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
			<div class="attachments hidden" id="attachments" />
			<div class="composer">
				<input
					type="file"
					id="file"
					accept="image/*,audio/*"
					multiple
					class="hidden"
				/>
				<button
					type="button"
					id="attach"
					class="ghost icon"
					title="Attach an image or audio file"
				>
					+
				</button>
				<button
					type="button"
					id="mic"
					class="ghost icon hidden"
					title="Record a voice note"
				>
					🎤
				</button>
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
			title={`${props.name} — Settings`}
			name={props.name}
			active="setup"
			authEnabled={props.authEnabled}
		>
			<h1>
				{props.complete ? "Settings" : "Welcome — let's set up your companion"}
			</h1>
			<p class="sub">
				Persona and facts apply immediately. Everything else is saved to your
				<code> .env</code> and takes effect after a restart. Empty optional
				fields are left untouched; secrets are never shown back, only whether
				one is set.
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

				<p class="caption">Generation tuning</p>
				<label for="think">Reasoning / thinking</label>
				<select id="think">
					{["true", "false", "low", "medium", "high"].map((o) => (
						<option value={o} selected={v.think === o}>
							{o}
						</option>
					))}
				</select>
				<label for="temperature">Temperature</label>
				<input
					type="number"
					id="temperature"
					step="0.1"
					value={String(v.temperature)}
					placeholder="0.7"
				/>
				<label for="numCtx">Context window (num_ctx, tokens)</label>
				<input
					type="number"
					id="numCtx"
					value={String(v.numCtx)}
					placeholder="8192"
				/>
				<label for="maxTokens">Max reply tokens</label>
				<input
					type="number"
					id="maxTokens"
					value={String(v.maxTokens)}
					placeholder="1000"
				/>
				<label for="historyLimit">
					History limit (prior messages sent each turn)
				</label>
				<input
					type="number"
					id="historyLimit"
					value={String(v.historyLimit)}
					placeholder="60"
				/>
				<label for="timeoutMs">Request timeout (ms)</label>
				<input
					type="number"
					id="timeoutMs"
					value={String(v.timeoutMs)}
					placeholder="120000"
				/>

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
				<label for="telegramReplySplit">
					Send each paragraph as its own message
				</label>
				<select id="telegramReplySplit">
					<option value="true" selected={v.telegramReplySplit}>
						Yes — text like a person
					</option>
					<option value="false" selected={!v.telegramReplySplit}>
						No — one message per reply
					</option>
				</select>
				<label for="telegramBatchIdleMs">
					Batch idle flush (ms of silence before a burst is answered)
				</label>
				<input
					type="number"
					id="telegramBatchIdleMs"
					value={String(v.telegramBatchIdleMs)}
					placeholder="2500"
				/>
				<label for="telegramBatchMaxMs">Batch max wait (ms cap)</label>
				<input
					type="number"
					id="telegramBatchMaxMs"
					value={String(v.telegramBatchMaxMs)}
					placeholder="15000"
				/>
			</div>

			<h2>Memory</h2>
			<div class="card">
				<label for="memoryContextDays">
					Daily summaries kept in context (days)
				</label>
				<input
					type="number"
					id="memoryContextDays"
					value={String(v.memoryContextDays)}
					placeholder="7"
				/>
				<label for="memoryLimit">Saved memories surfaced in context</label>
				<input
					type="number"
					id="memoryLimit"
					value={String(v.memoryLimit)}
					placeholder="40"
				/>
				<label for="memoryNoteTitles">Note titles surfaced in context</label>
				<input
					type="number"
					id="memoryNoteTitles"
					value={String(v.memoryNoteTitles)}
					placeholder="12"
				/>
				<label for="memorySummaryCron">Nightly roll-up schedule (cron)</label>
				<input
					type="text"
					id="memorySummaryCron"
					value={v.memorySummaryCron}
					placeholder="55 23 * * *"
				/>
			</div>

			<h2>Web access (optional)</h2>
			<div class="card">
				<p class="sub">
					Lets the companion search the web and read links during a reply.
				</p>
				<label for="webEnabled">Web access</label>
				<select id="webEnabled">
					<option value="true" selected={v.webEnabled}>
						On
					</option>
					<option value="false" selected={!v.webEnabled}>
						Off
					</option>
				</select>
				<label for="webSearchProvider">Search provider</label>
				<select id="webSearchProvider">
					<option
						value="duckduckgo"
						selected={v.webSearchProvider === "duckduckgo"}
					>
						DuckDuckGo (keyless)
					</option>
					<option value="tavily" selected={v.webSearchProvider === "tavily"}>
						Tavily (needs key, better)
					</option>
				</select>
				<label for="tavilyKey">
					Tavily API key{" "}
					{v.tavilyConfigured ? "(set — enter a new one to replace)" : ""}
				</label>
				<input
					type="password"
					id="tavilyKey"
					placeholder={v.tavilyConfigured ? "•".repeat(12) : "tvly-…"}
					autocomplete="off"
				/>
				<label for="webSteps">Max lookup rounds per turn</label>
				<input
					type="number"
					id="webSteps"
					value={String(v.webSteps)}
					placeholder="3"
				/>
				<label for="webResults">Results per search</label>
				<input
					type="number"
					id="webResults"
					value={String(v.webResults)}
					placeholder="5"
				/>
				<label for="webPageChars">Characters per fetched page</label>
				<input
					type="number"
					id="webPageChars"
					value={String(v.webPageChars)}
					placeholder="6000"
				/>
				<label for="webSearchTimeoutMs">Search timeout (ms)</label>
				<input
					type="number"
					id="webSearchTimeoutMs"
					value={String(v.webSearchTimeoutMs)}
					placeholder="12000"
				/>
				<label for="webFetchTimeoutMs">Fetch timeout (ms)</label>
				<input
					type="number"
					id="webFetchTimeoutMs"
					value={String(v.webFetchTimeoutMs)}
					placeholder="12000"
				/>
				<label for="webMaxReqs">Max concurrent lookups per round</label>
				<input
					type="number"
					id="webMaxReqs"
					value={String(v.webMaxReqs)}
					placeholder="3"
				/>
			</div>

			<h2>Speech-to-text (optional)</h2>
			<div class="card">
				<p class="sub">
					Transcribes voice notes before the companion reads them.
				</p>
				<label for="sttProvider">Provider</label>
				<select id="sttProvider">
					<option value="off" selected={v.sttProvider === "off"}>
						Off
					</option>
					<option value="openai" selected={v.sttProvider === "openai"}>
						OpenAI
					</option>
					<option
						value="whisper-http"
						selected={v.sttProvider === "whisper-http"}
					>
						Whisper (OpenAI-compatible HTTP)
					</option>
					<option value="local" selected={v.sttProvider === "local"}>
						Local (whisper.cpp on this machine)
					</option>
				</select>
				<label for="sttApiUrl">
					Transcription endpoint URL (HTTP provider)
				</label>
				<input
					type="text"
					id="sttApiUrl"
					value={v.sttApiUrl}
					placeholder="https://…/v1/audio/transcriptions"
				/>
				<label for="sttApiKey">
					API key {v.sttConfigured ? "(set — enter a new one to replace)" : ""}
				</label>
				<input
					type="password"
					id="sttApiKey"
					placeholder={v.sttConfigured ? "•".repeat(12) : ""}
					autocomplete="off"
				/>
				<label for="sttModel">Model (HTTP provider)</label>
				<input
					type="text"
					id="sttModel"
					value={v.sttModel}
					placeholder="whisper-1"
				/>
				<label for="sttLocalModel">
					Local model file (whisper.cpp ggml/gguf — Local provider)
				</label>
				<input
					type="text"
					id="sttLocalModel"
					value={v.sttLocalModel}
					placeholder="./data/models/ggml-base.bin"
				/>
				<label for="sttLanguage">
					Spoken language (Local provider; "auto" detects)
				</label>
				<input
					type="text"
					id="sttLanguage"
					value={v.sttLanguage}
					placeholder="auto"
				/>
				<p class="sub">
					Local needs <code>whisper-cli</code> and <code>ffmpeg</code> on PATH
					(override with <code>STT_LOCAL_BIN</code> /{" "}
					<code>STT_FFMPEG_BIN</code>).
				</p>
			</div>

			<h2>Weather (optional)</h2>
			<div class="card">
				<p class="sub">
					If set, the companion knows your local weather (Open-Meteo, no key).
				</p>
				<label for="weatherLat">Latitude</label>
				<input
					type="text"
					id="weatherLat"
					value={v.weatherLat}
					placeholder="e.g. 52.52"
				/>
				<label for="weatherLon">Longitude</label>
				<input
					type="text"
					id="weatherLon"
					value={v.weatherLon}
					placeholder="e.g. 13.41"
				/>
				<label for="weatherLocationName">
					Location name (shown in context)
				</label>
				<input
					type="text"
					id="weatherLocationName"
					value={v.weatherLocationName}
					placeholder="e.g. Berlin"
				/>
			</div>

			<h2>App &amp; access</h2>
			<div class="card">
				<label for="timezone">Timezone (IANA)</label>
				<input type="text" id="timezone" value={v.timezone} placeholder="UTC" />
				<label for="dataDir">Data directory</label>
				<input
					type="text"
					id="dataDir"
					value={v.dataDir}
					placeholder="./data"
				/>
				<label for="port">Web interface port</label>
				<input
					type="number"
					id="port"
					value={String(v.port)}
					placeholder="8080"
				/>
				<label for="webAuthPassword">
					Web UI password{" "}
					{v.webAuthConfigured
						? "(set — enter a new one to replace)"
						: "(leave blank only behind a trusted network)"}
				</label>
				<input
					type="password"
					id="webAuthPassword"
					placeholder={v.webAuthConfigured ? "•".repeat(12) : ""}
					autocomplete="off"
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
