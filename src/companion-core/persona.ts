/**
 * Persona assembly. The companion's identity is *configuration*, resolved at
 * runtime from (in order of precedence): a settings override saved in the UI, a
 * `persona/persona.md` file, or a built-in preset. The operating block describes
 * the medium, the memory model, and the web sidecar tags — generic, not
 * persona-specific.
 * Live per-turn context (date, weather, Core, summaries) is assembled in
 * ./context.ts. See docs/configuration.md and
 * docs/decisions/persona-as-configuration.md.
 */
import { existsSync, readFileSync } from "node:fs";

import { config } from "#/config/index.ts";
import { getSetting } from "./memory/store.ts";
import { companionPreset, PRESETS } from "./presets.ts";

const PERSONA_FILE = "persona/persona.md";

/** Fill {{name}} / {{owner}} placeholders in user-supplied persona text. */
function interpolate(text: string): string {
	return text
		.replaceAll("{{name}}", config.app.name)
		.replaceAll("{{owner}}", config.app.owner);
}

/** The resolved identity block (no operating instructions, no live context). */
export function buildIdentity(): string {
	const override = getSetting("persona");
	if (override?.trim()) return interpolate(override);

	if (existsSync(PERSONA_FILE)) {
		try {
			const file = readFileSync(PERSONA_FILE, "utf8");
			if (file.trim()) return interpolate(file);
		} catch {
			// fall through to a preset
		}
	}

	const preset = PRESETS[config.persona.preset] ?? companionPreset;
	return preset({ name: config.app.name, owner: config.app.owner });
}

/** Generic instructions: the medium, the memory model, and the web sidecar tags. */
export function buildOperating(opts: {
	web: boolean;
	/** Whether the nightly roll-up curates memory on its own (MEMORY_ROLLUP_EXTRACT). */
	autoMemory: boolean;
}): string {
	const owner = config.app.owner;
	const parts: string[] = [];

	parts.push(`## How this works

You talk with ${owner} in an ongoing conversation. Messages arrive as text, and depending
on how ${owner} reaches you, sometimes as voice notes (already transcribed for you) or
photos (you can see them). You reply in text, sized to the moment.

Everything you know is already in front of you: your Core, the things you've saved, and
your recent daily summaries are above; the date${
		config.weather.lat != null ? " and weather" : ""
	} ride along in the [context] note on ${owner}'s latest message. That [context] note is
ambient background the system hands you — it is NOT something ${owner} said, and never
something to save as a memory. Use it naturally, the way someone who knows ${owner} just
would, and never mention these notes or that they exist. When ${owner} says "remember that"
or "the last thing you said" or "that fact", they mean what was actually said in your
conversation — your messages and theirs — not the ambient context.`);

	parts.push(`## Your memory

Today's conversation is your live working memory. Each night it is compressed into a short
summary, and new days open from those summaries plus your Core and saved memories.`);

	if (opts.autoMemory) {
		parts.push(`Your memory is kept for you. You don't save or forget anything by hand mid-conversation, and
you can't on the spot — so never say you just saved, updated, or forgot something. Instead,
once the day is over, what matters from it settles in on its own: anything lasting ${owner}
told you — a name, someone in their life, their work, a standing preference, a real plan or
date, a decision — is gathered into your memory overnight, and anything that turned out wrong
is quietly dropped. So you don't have to perform remembering. Just take it in and talk
naturally; trust that what counts will be there tomorrow. If ${owner} asks you to remember or
drop something, you can reassure them it'll be kept (or let go) — and that they can also edit
your memory themselves from the settings.`);
	} else {
		parts.push(`Your memory is managed for you: you can read everything above, but you cannot add, change,
or remove what you keep on your own. So never claim to have saved, updated, or forgotten
something. If ${owner} asks you to remember or forget a thing, tell them plainly that they
keep your memory themselves from the settings.`);
	}

	if (opts.web)
		parts.push(`## Reaching the web

For something that isn't already in front of you, you can look it up. End your message with
one of these on its own line and nothing else; it runs quietly and the results come back to
you, and only then do you write your real reply:
<search>what you want to find</search>
<fetch>https://the-exact-link</fetch>
Reach for it only when it actually helps; lean on what you already know the rest of the time.
When results land, fold what you found into your own words and just talk like you know it.
Don't announce that you searched, and don't dump raw links unless one genuinely helps.`);

	parts.push("Think briefly, and don't overthink simple messages.");

	return parts.join("\n\n");
}
