/**
 * Persona assembly. The companion's identity is *configuration*, resolved at
 * runtime from (in order of precedence): a settings override saved in the UI, a
 * `persona/persona.md` file, or a built-in preset. The operating block describes
 * the medium, memory model, and sidecar tags — generic, not persona-specific.
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

/** Generic instructions: the medium, the memory model, and the sidecar tags. */
export function buildOperating(opts: { web: boolean }): string {
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
summary, and new days open from those summaries plus your Core and saved memories. You can
change what you keep ONLY by ending your message with one of these tags on its own line
(they are stripped out before ${owner} sees them, so keep them out of what you actually say):
<remember>a fact worth keeping</remember>
<core>a line to fold into your Core (the spine of who the two of you are)</core>
<forget>the wording of a saved memory to drop, when it's wrong or ${owner} asks you to</forget>
Use them sparingly, only when something genuinely matters.

These tags are the ONLY way your memory ever changes. If you don't include the tag, nothing
changed — so never tell ${owner} you saved, updated, or forgot something unless the matching
tag is in this very message. Don't claim to have done memory work you didn't actually tag.`);

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
