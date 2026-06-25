/**
 * Sidecar actions. Instead of an API tool-call loop (unreliable on small local
 * models), the companion may append tiny tags to its reply to act on its own
 * memory. We parse them, apply the side effects, and strip them from the text
 * the user sees. Tolerant by design: malformed or absent tags leave the reply
 * untouched. See docs/decisions/sidecar-tags-not-tool-calling.md.
 */
import { addMemory, getCore, setCore } from "./memory/store.ts";

const RE_REMEMBER = /<remember>([\s\S]*?)<\/remember>/gi;
const RE_CORE = /<core>([\s\S]*?)<\/core>/gi;

export interface ParsedActions {
	remember: string[];
	core: string[];
	/** The reply text with all action tags removed. */
	cleaned: string;
}

/** Pure: extract action tags and the cleaned text, with no side effects. */
export function parseActions(raw: string): ParsedActions {
	const remember: string[] = [];
	for (const m of raw.matchAll(RE_REMEMBER)) {
		const v = m[1]?.trim();
		if (v) remember.push(v);
	}

	const core: string[] = [];
	for (const m of raw.matchAll(RE_CORE)) {
		const v = m[1]?.trim();
		if (v) core.push(v);
	}

	const cleaned = raw
		.replace(RE_REMEMBER, "")
		.replace(RE_CORE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return { remember, core, cleaned };
}

/** Apply any sidecar tags in `raw` to memory, then return the cleaned reply. */
export function applyActions(raw: string): string {
	const parsed = parseActions(raw);
	let applied = 0;

	for (const fact of parsed.remember) {
		addMemory(fact);
		applied++;
	}

	for (const line of parsed.core) {
		const existing = getCore().trim();
		setCore(existing ? `${existing}\n${line}` : line);
		applied++;
	}

	if (applied) console.log(`[companion] applied ${applied} sidecar action(s)`);
	return parsed.cleaned;
}
