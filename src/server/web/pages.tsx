/**
 * Server-rendered pages (Hono JSX, no build step). Each page is a static shell;
 * the interactivity lives in the small scripts served from ./assets.ts and
 * talks to the JSON API in ./api.ts. See docs/channels.md (built-in web chat)
 * and docs/tech-stack.md (why server-rendered, no SPA bundler).
 */
import { raw } from "hono/html";
import type { Child, PropsWithChildren } from "hono/jsx";

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

/**
 * A labelled Settings field: the control plus an explanatory hint beneath it, so
 * every option says what it does (and what the trade-off is) rather than leaving
 * a bare input to guess at. Used throughout the Settings page.
 */
const Field = (
	props: PropsWithChildren<{ id?: string; label: Child; hint?: Child }>,
) => (
	<div class="field">
		<label for={props.id}>{props.label}</label>
		{props.children}
		{props.hint ? <p class="hint">{props.hint}</p> : null}
	</div>
);

/**
 * Every IANA timezone for the picker (from the JS engine), with the currently
 * configured value and UTC guaranteed present. Falls back to a tiny list if the
 * runtime doesn't expose `Intl.supportedValuesOf`.
 */
function timezoneOptions(current: string): string[] {
	const fn = (
		Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
	).supportedValuesOf;
	let zones: string[] = [];
	try {
		zones = fn ? fn("timeZone") : [];
	} catch {
		zones = [];
	}
	if (!zones.length) zones = ["UTC", "Europe/London", "America/New_York"];
	if (!zones.includes("UTC")) zones = ["UTC", ...zones];
	if (current && !zones.includes(current)) zones = [current, ...zones];
	return zones;
}

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
				Every setting is explained inline.{" "}
				<strong>Persona and the facts you seed apply immediately</strong>
				{"; "}everything else is written to your <code>.env</code> and takes
				effect after a restart (or instantly, if you turn on auto-restart
				below). Blank optional fields are left untouched, and secrets are never
				shown back — only whether one is already set.
			</p>

			<h2>Identity</h2>
			<div class="card">
				<Field
					id="name"
					label="What is your companion called?"
					hint="The name it goes by everywhere — the chat header, Telegram, and how it refers to itself."
				>
					<input type="text" id="name" value={v.name} placeholder="Companion" />
				</Field>
				<Field
					id="owner"
					label="What should it call you?"
					hint="How the companion addresses you. A first name or nickname feels most natural."
				>
					<input type="text" id="owner" value={v.owner} placeholder="friend" />
				</Field>

				<p class="caption">Starting personality (preset)</p>
				<p class="hint" style="margin-top:0">
					A neutral archetype to begin from. It shapes tone and temperament; you
					can refine or fully override it below.
				</p>
				{PRESETS.map((p) => (
					<label class="row pick" style="margin:4px 0">
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

				<Field
					id="persona"
					label="Custom persona (optional — overrides the preset)"
					hint={
						<>
							Describe who your companion is in your own words: voice, history,
							quirks, how it should treat you. When present this replaces the
							preset entirely. <code>{"{{name}}"}</code> and{" "}
							<code>{"{{owner}}"}</code> are filled in for you.
						</>
					}
				>
					<textarea
						id="persona"
						rows={10}
						placeholder="Describe who your companion is, in your own words…"
					>
						{v.persona}
					</textarea>
				</Field>

				<Field
					id="coreSeed"
					label="A few facts about you to start from (optional)"
					hint="Seeds the living “Core” memory on first save — your name, what you do, what matters right now. The companion edits this itself over time."
				>
					<textarea
						id="coreSeed"
						rows={4}
						placeholder="What your companion should know about you from day one…"
					/>
				</Field>
			</div>

			<h2>Model</h2>
			<div class="card">
				<Field
					id="provider"
					label="Provider"
					hint={
						<>
							<strong>Ollama</strong> runs a model on this machine — private,
							free, nothing leaves the box. <strong>OpenAI-compatible</strong>{" "}
							talks to any hosted endpoint (OpenAI, OpenRouter, Groq, LM Studio,
							vLLM, …).
						</>
					}
				>
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
				</Field>

				<Field
					id="model"
					label="Model"
					hint={
						<>
							The model name as your provider knows it. Start typing for a few
							suggestions, or paste any name your endpoint serves.
						</>
					}
				>
					<input
						type="text"
						id="model"
						list="modelOptions"
						value={v.model}
						placeholder="gemma4:12b"
					/>
					<datalist id="modelOptions">
						<option value="gemma4:12b" />
						<option value="gemma4:12b-mlx" />
						<option value="llama3.2" />
						<option value="qwen2.5:14b" />
						<option value="gpt-4o-mini" />
						<option value="gpt-4o" />
						<option value="anthropic/claude-3.5-sonnet" />
					</datalist>
				</Field>

				<div id="ollamaRow" class={ollama ? "" : "hidden"}>
					<Field
						id="ollamaUrl"
						label="Ollama URL"
						hint="Where your local Ollama is listening. The default is right unless you moved it or run it on another host."
					>
						<input
							type="text"
							id="ollamaUrl"
							value={v.ollamaUrl}
							placeholder="http://localhost:11434"
						/>
					</Field>
				</div>

				<div id="hostedRows" class={ollama ? "hidden" : ""}>
					<Field
						id="baseUrl"
						label="Base URL"
						hint="The API root, ending before /chat/completions — e.g. https://openrouter.ai/api/v1."
					>
						<input
							type="text"
							id="baseUrl"
							value={v.baseUrl}
							placeholder="https://api.openai.com/v1"
						/>
					</Field>
					<Field
						id="apiKey"
						label="API key"
						hint="Sent as a Bearer token. Stored in your .env, never shown back here."
					>
						<input
							type="password"
							id="apiKey"
							placeholder={"•".repeat(12)}
							autocomplete="off"
						/>
					</Field>
				</div>

				<p class="caption">Generation tuning</p>
				<Field
					id="think"
					label="Reasoning / thinking"
					hint={
						<>
							How much the model deliberates before replying. <code>true</code>/
							<code>false</code> toggle it; <code>low</code>/<code>medium</code>
							/<code>high</code> set the effort. Ollama honors all five; hosted
							endpoints map the effort levels to <code>reasoning_effort</code>{" "}
							(ignored by non-reasoning models).
						</>
					}
				>
					<select id="think">
						{["true", "false", "low", "medium", "high"].map((o) => (
							<option value={o} selected={v.think === o}>
								{o}
							</option>
						))}
					</select>
				</Field>
				<Field
					id="temperature"
					label="Temperature"
					hint={
						<>
							How much replies vary. Lower is steadier and more focused; higher
							is looser and more surprising. <code>0.7</code> is a balanced
							default.
						</>
					}
				>
					<div class="range-row">
						<input
							type="range"
							id="temperature"
							min="0"
							max="2"
							step="0.1"
							value={String(v.temperature)}
						/>
						<output id="temperatureOut">
							{Number(v.temperature).toFixed(1)}
						</output>
					</div>
				</Field>
				<Field
					id="numCtx"
					label="Context window (num_ctx, tokens)"
					hint="How much the local model can hold at once (Ollama only). Bigger remembers more per turn but uses more memory and runs slower; hosted models ignore it."
				>
					<input
						type="number"
						id="numCtx"
						value={String(v.numCtx)}
						placeholder="8192"
					/>
				</Field>
				<Field
					id="maxTokens"
					label="Max reply length (tokens)"
					hint="A ceiling on how long a single reply can get. ~1000 is a few solid paragraphs."
				>
					<input
						type="number"
						id="maxTokens"
						value={String(v.maxTokens)}
						placeholder="1000"
					/>
				</Field>
				<Field
					id="historyLimit"
					label="History sent each turn (messages)"
					hint="How many of today's prior messages ride along for continuity. Higher feels more aware of the conversation but costs more tokens per turn."
				>
					<input
						type="number"
						id="historyLimit"
						value={String(v.historyLimit)}
						placeholder="60"
					/>
				</Field>
				<Field
					id="timeoutMs"
					label="Request timeout (ms)"
					hint="How long to wait for the model before giving up. Local models on a cold start can be slow — 120000 is two minutes."
				>
					<input
						type="number"
						id="timeoutMs"
						value={String(v.timeoutMs)}
						placeholder="120000"
					/>
				</Field>

				<div class="row" style="margin-top:12px">
					<button type="button" id="test" class="ghost">
						Test connection
					</button>
				</div>
				<div id="testNote" class="note hidden" />
			</div>

			<h2>Chat</h2>
			<div class="card">
				<p class="sub">
					How a burst of quick messages is folded into one turn — applied to
					<strong> both the web chat and Telegram</strong>. The idea: when you
					fire off several short messages in a row, the companion waits a beat
					and answers the whole thought at once, instead of replying to each
					line mid-sentence.
				</p>
				<Field
					id="chatBatchIdleMs"
					label="Idle flush (ms of silence)"
					hint="Each new message resets this timer; when you go quiet for this long, the burst flushes and the reply begins. This is the usual path — a natural pause means you're done. Lower feels snappier; higher waits longer for you to keep typing."
				>
					<input
						type="number"
						id="chatBatchIdleMs"
						value={String(v.chatBatchIdleMs)}
						placeholder="2500"
					/>
				</Field>
				<Field
					id="chatBatchMaxMs"
					label="Max wait (ms cap)"
					hint="A ceiling measured from the first message of the burst, so a steady stream that never pauses still gets answered. The batch always flushes by this point, even if you're still typing."
				>
					<input
						type="number"
						id="chatBatchMaxMs"
						value={String(v.chatBatchMaxMs)}
						placeholder="15000"
					/>
				</Field>
			</div>

			<h2>Telegram (optional)</h2>
			<div class="card">
				<p class="sub">
					Reach your companion from your phone over Telegram. Leave blank to use
					the built-in web chat only.{" "}
					{v.telegramConfigured
						? "A token is already set; entering a new one replaces it."
						: "Get a token from @BotFather."}
				</p>
				<Field
					id="telegramToken"
					label="Bot token"
					hint={
						<>
							Create a bot with <strong>@BotFather</strong> and paste its token.
							This alone switches the Telegram channel on.
						</>
					}
				>
					<input
						type="password"
						id="telegramToken"
						placeholder="123456:ABC-…"
						autocomplete="off"
					/>
				</Field>
				<Field
					id="telegramAllowedIds"
					label="Allowed Telegram user IDs"
					hint={
						<>
							Only these numeric IDs get a reply — everyone else is silently
							ignored, so the bot is yours alone. Get yours from{" "}
							<strong>@userinfobot</strong>; separate several with commas. Empty
							means nobody is answered.
						</>
					}
				>
					<input
						type="text"
						id="telegramAllowedIds"
						value={v.telegramAllowedIds}
						placeholder="e.g. 12345678"
					/>
				</Field>
				<Field
					id="telegramReplySplit"
					label="Reply style"
					hint="Whether a long reply arrives as several texting-style messages or one block."
				>
					<select id="telegramReplySplit">
						<option value="true" selected={v.telegramReplySplit}>
							Split into paragraph-sized messages (like a person texting)
						</option>
						<option value="false" selected={!v.telegramReplySplit}>
							One message per reply
						</option>
					</select>
				</Field>
			</div>

			<h2>Memory</h2>
			<div class="card">
				<p class="sub">
					Today's chat is live working memory. Each night it's compressed into a
					one-line-per-day summary; past days live on as those summaries plus
					the Core and your saved memories.
				</p>
				<Field
					id="memoryContextDays"
					label="Recent days kept in context"
					hint="How many past daily summaries to carry into each conversation. More gives longer continuity at a small token cost."
				>
					<input
						type="number"
						id="memoryContextDays"
						value={String(v.memoryContextDays)}
						placeholder="7"
					/>
				</Field>
				<Field
					id="memoryLimit"
					label="Saved memories surfaced"
					hint="How many discrete saved facts to include each turn (most recent first). They're the things the companion chose to remember, or that you added."
				>
					<input
						type="number"
						id="memoryLimit"
						value={String(v.memoryLimit)}
						placeholder="40"
					/>
				</Field>
				<Field
					id="memorySummaryCron"
					label="Nightly roll-up schedule"
					hint={
						<>
							When the day gets compressed (5-field cron, in your timezone).
							It's downtime-resilient: a run missed while the machine was asleep
							is caught up on the next boot.{" "}
							<span id="cronHuman" class="cron-human" />
						</>
					}
				>
					<select id="cronPreset">
						<option value="">Pick a common schedule…</option>
						<option value="55 23 * * *">Nightly at 23:55 (default)</option>
						<option value="0 0 * * *">Every midnight</option>
						<option value="0 3 * * *">Nightly at 3:00 AM</option>
						<option value="0 */6 * * *">Every 6 hours</option>
						<option value="0 4 * * 0">Weekly — Sunday 4:00 AM</option>
					</select>
					<input
						type="text"
						id="memorySummaryCron"
						value={v.memorySummaryCron}
						placeholder="55 23 * * *"
						style="margin-top:8px"
					/>
				</Field>
			</div>

			<h2>Web access (optional)</h2>
			<div class="card">
				<p class="sub">
					Lets the companion look something up mid-reply — it emits a quiet
					search/fetch, reads the results, then answers. Off keeps every turn
					fully local.
				</p>
				<Field
					id="webEnabled"
					label="Web access"
					hint="Master switch. When off, the companion leans only on what it already knows and never reaches the network for a reply."
				>
					<select id="webEnabled">
						<option value="true" selected={v.webEnabled}>
							On
						</option>
						<option value="false" selected={!v.webEnabled}>
							Off
						</option>
					</select>
				</Field>
				<Field
					id="webSearchProvider"
					label="Search provider"
					hint={
						<>
							<strong>DuckDuckGo</strong> needs no key and works out of the box.{" "}
							<strong>Tavily</strong> returns cleaner, model-ready results but
							needs an API key.
						</>
					}
				>
					<select id="webSearchProvider">
						<option
							value="duckduckgo"
							selected={v.webSearchProvider === "duckduckgo"}
						>
							DuckDuckGo (keyless)
						</option>
						<option value="tavily" selected={v.webSearchProvider === "tavily"}>
							Tavily (needs key, cleaner results)
						</option>
					</select>
				</Field>
				<Field
					id="tavilyKey"
					label={
						<>
							Tavily API key{" "}
							{v.tavilyConfigured ? "(set — enter a new one to replace)" : ""}
						</>
					}
					hint="Only needed if you picked Tavily above. Stored in your .env, never shown back."
				>
					<input
						type="password"
						id="tavilyKey"
						placeholder={v.tavilyConfigured ? "•".repeat(12) : "tvly-…"}
						autocomplete="off"
					/>
				</Field>
				<p class="caption">Limits (advanced)</p>
				<Field
					id="webSteps"
					label="Max lookup rounds per turn"
					hint="How many times one reply may search-and-reconsider before it must answer. Guards against endless loops."
				>
					<input
						type="number"
						id="webSteps"
						value={String(v.webSteps)}
						placeholder="3"
					/>
				</Field>
				<Field
					id="webResults"
					label="Results per search"
					hint="How many hits each search returns for the model to weigh."
				>
					<input
						type="number"
						id="webResults"
						value={String(v.webResults)}
						placeholder="5"
					/>
				</Field>
				<Field
					id="webPageChars"
					label="Characters per fetched page"
					hint="How much of a fetched page is read in. Higher captures more context but spends more tokens."
				>
					<input
						type="number"
						id="webPageChars"
						value={String(v.webPageChars)}
						placeholder="6000"
					/>
				</Field>
				<Field
					id="webSearchTimeoutMs"
					label="Search timeout (ms)"
					hint="How long to wait on a search before moving on. A slow lookup degrades to “no results”, never an error."
				>
					<input
						type="number"
						id="webSearchTimeoutMs"
						value={String(v.webSearchTimeoutMs)}
						placeholder="12000"
					/>
				</Field>
				<Field
					id="webFetchTimeoutMs"
					label="Fetch timeout (ms)"
					hint="The same patience, applied to reading a single linked page."
				>
					<input
						type="number"
						id="webFetchTimeoutMs"
						value={String(v.webFetchTimeoutMs)}
						placeholder="12000"
					/>
				</Field>
				<Field
					id="webMaxReqs"
					label="Max lookups per round"
					hint="How many searches/fetches can run at once within a single round."
				>
					<input
						type="number"
						id="webMaxReqs"
						value={String(v.webMaxReqs)}
						placeholder="3"
					/>
				</Field>
			</div>

			<h2>Speech-to-text (optional)</h2>
			<div class="card">
				<p class="sub">
					Transcribes voice notes — Telegram voice and the web chat's mic /
					audio uploads — into text before the companion reads them. Only the
					fields for the provider you pick are shown.
				</p>
				<Field
					id="sttProvider"
					label="Provider"
					hint={
						<>
							<strong>Local</strong> runs whisper.cpp on this machine — private,
							no key, nothing leaves the box. <strong>OpenAI</strong> uses the
							hosted Whisper API. <strong>Whisper HTTP</strong> points at any
							OpenAI-compatible transcription endpoint (e.g. a faster-whisper
							server).
						</>
					}
				>
					<select id="sttProvider">
						<option value="off" selected={v.sttProvider === "off"}>
							Off — ask me to text instead
						</option>
						<option value="local" selected={v.sttProvider === "local"}>
							Local (whisper.cpp on this machine)
						</option>
						<option value="openai" selected={v.sttProvider === "openai"}>
							OpenAI (hosted Whisper)
						</option>
						<option
							value="whisper-http"
							selected={v.sttProvider === "whisper-http"}
						>
							Whisper HTTP (OpenAI-compatible endpoint)
						</option>
					</select>
				</Field>
				<div data-stt="whisper-http">
					<Field
						id="sttApiUrl"
						label="Transcription endpoint URL"
						hint="The full /audio/transcriptions URL of your Whisper-compatible server."
					>
						<input
							type="text"
							id="sttApiUrl"
							value={v.sttApiUrl}
							placeholder="https://…/v1/audio/transcriptions"
						/>
					</Field>
				</div>
				<div data-stt="openai whisper-http">
					<Field
						id="sttApiKey"
						label={
							<>
								API key{" "}
								{v.sttConfigured ? "(set — enter a new one to replace)" : ""}
							</>
						}
						hint="Sent as a Bearer token to the transcription endpoint. Some local servers don't need one."
					>
						<input
							type="password"
							id="sttApiKey"
							placeholder={v.sttConfigured ? "•".repeat(12) : ""}
							autocomplete="off"
						/>
					</Field>
					<Field
						id="sttModel"
						label="Model"
						hint="The transcription model name, e.g. whisper-1 for OpenAI."
					>
						<input
							type="text"
							id="sttModel"
							value={v.sttModel}
							placeholder="whisper-1"
						/>
					</Field>
				</div>
				<div data-stt="local">
					<Field
						id="sttLocalModel"
						label="Local model file"
						hint={
							<>
								Path to a whisper.cpp ggml/gguf model. On macOS:{" "}
								<code>brew install whisper-cpp ffmpeg</code>, then download one
								(e.g. <code>ggml-base.bin</code>) into <code>data/models/</code>
								. Voice stays off until this file exists.
							</>
						}
					>
						<input
							type="text"
							id="sttLocalModel"
							value={v.sttLocalModel}
							placeholder="./data/models/ggml-base.bin"
						/>
					</Field>
					<Field
						id="sttLanguage"
						label="Spoken language"
						hint={
							<>
								A hint for the transcriber. <code>auto</code> detects it;
								otherwise a code like <code>en</code> or <code>ru</code> can
								improve accuracy.
							</>
						}
					>
						<input
							type="text"
							id="sttLanguage"
							value={v.sttLanguage}
							placeholder="auto"
						/>
					</Field>
					<p class="hint">
						Needs <code>whisper-cli</code> and <code>ffmpeg</code> on PATH
						(override the paths with <code>STT_LOCAL_BIN</code> /{" "}
						<code>STT_FFMPEG_BIN</code> in your <code>.env</code>).
					</p>
				</div>
			</div>

			<h2>Weather (optional)</h2>
			<div class="card">
				<p class="sub">
					If set, the companion quietly knows your local weather (Open-Meteo, no
					key). Search for your city — it fills the coordinates and name, and
					can match your timezone above.
				</p>
				<Field
					id="geoSearch"
					label="Find your location"
					hint="Type a city and pick it from the list. Looked up through your own server via Open-Meteo's keyless geocoder — your browser never talks to it directly, and nothing is stored remotely."
				>
					<div class="geo">
						<input
							type="text"
							id="geoSearch"
							autocomplete="off"
							placeholder="Search a city — e.g. Berlin, Nairobi, Tokyo…"
						/>
						<div id="geoResults" class="geo-results hidden" />
					</div>
				</Field>
				<div
					id="geoSelected"
					class={
						v.weatherLat && v.weatherLon ? "geo-chosen" : "geo-chosen hidden"
					}
				>
					Using{" "}
					<strong id="geoChosenName">{v.weatherLocationName || "—"}</strong>{" "}
					<span class="sub" id="geoChosenCoords">
						{v.weatherLat && v.weatherLon
							? `(${v.weatherLat}, ${v.weatherLon})`
							: ""}
					</span>
				</div>
				<details class="manual" open={!!v.weatherLat && !v.weatherLocationName}>
					<summary>Set coordinates manually</summary>
					<Field
						id="weatherLat"
						label="Latitude"
						hint="Decimal degrees, north positive (e.g. 52.52)."
					>
						<input
							type="text"
							id="weatherLat"
							value={v.weatherLat}
							placeholder="e.g. 52.52"
						/>
					</Field>
					<Field
						id="weatherLon"
						label="Longitude"
						hint="Decimal degrees, east positive (e.g. 13.41)."
					>
						<input
							type="text"
							id="weatherLon"
							value={v.weatherLon}
							placeholder="e.g. 13.41"
						/>
					</Field>
					<Field
						id="weatherLocationName"
						label="Location name"
						hint="A friendly label the companion uses when it mentions the weather (e.g. “Berlin”)."
					>
						<input
							type="text"
							id="weatherLocationName"
							value={v.weatherLocationName}
							placeholder="e.g. Berlin"
						/>
					</Field>
				</details>
			</div>

			<h2>App &amp; access</h2>
			<div class="card">
				<Field
					id="timezone"
					label="Timezone"
					hint="Sets the day boundary for memory, when the nightly roll-up runs, and the date the companion sees. Search the list, or detect it from this browser."
				>
					<select id="timezone">
						{timezoneOptions(v.timezone).map((z) => (
							<option value={z} selected={z === v.timezone}>
								{z}
							</option>
						))}
					</select>
					<div class="field-actions">
						<button type="button" id="tzDetect" class="ghost">
							Detect from browser
						</button>
					</div>
				</Field>
				<Field
					id="dataDir"
					label="Data directory"
					hint={
						<>
							Where the SQLite database and uploaded attachments live. Keep it
							off version control. Changing it points at a different (possibly
							empty) history.
						</>
					}
				>
					<input
						type="text"
						id="dataDir"
						value={v.dataDir}
						placeholder="./data"
					/>
				</Field>
				<Field
					id="port"
					label="Web interface port"
					hint="The port this web app listens on. Change it if 8080 is taken."
				>
					<input
						type="number"
						id="port"
						value={String(v.port)}
						placeholder="8080"
					/>
				</Field>
				<Field
					id="webAuthPassword"
					label={
						<>
							Web UI password{" "}
							{v.webAuthConfigured
								? "(set — enter a new one to replace)"
								: "(leave blank only behind a trusted network)"}
						</>
					}
					hint="Gates this whole interface and its API behind a login. Safe to leave empty only on a trusted network like a tailnet or localhost."
				>
					<input
						type="password"
						id="webAuthPassword"
						placeholder={v.webAuthConfigured ? "•".repeat(12) : ""}
						autocomplete="off"
					/>
				</Field>
				<Field
					id="autoRestartOnSave"
					label="Restart automatically after saving"
					hint={
						<>
							Most settings only take effect on a restart. With this on, saving
							relaunches the app for you so everything applies right away.{" "}
							<strong>
								Only enable it when a supervisor keeps the process alive
							</strong>{" "}
							(launchd <code>KeepAlive</code>, Docker <code>restart:</code>,
							systemd <code>Restart=</code>) — otherwise the app would just
							stop.
						</>
					}
				>
					<select id="autoRestartOnSave">
						<option value="true" selected={v.autoRestartOnSave}>
							On — relaunch on save (supervised)
						</option>
						<option value="false" selected={!v.autoRestartOnSave}>
							Off — I'll restart it myself
						</option>
					</select>
				</Field>
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
