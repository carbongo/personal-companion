/**
 * Memory sidecar tags. The companion no longer manages memory mid-conversation —
 * that proved unreliable on small local models and now lives entirely in the
 * nightly roll-up (see ./memory/rollup.ts). What remains here is the pure parser:
 * the roll-up reuses it to read the `<remember>` / `<forget>` tags it asks the
 * model for, and the engine reuses it to strip any stray tag a reply emits so it
 * never leaks to the user. Tolerant by design: malformed or absent tags leave the
 * reply untouched. See docs/decisions/sidecar-tags-not-tool-calling.md.
 */

const RE_REMEMBER = /<remember>([\s\S]*?)<\/remember>/gi;
const RE_CORE = /<core>([\s\S]*?)<\/core>/gi;
const RE_FORGET = /<forget>([\s\S]*?)<\/forget>/gi;

export interface ParsedActions {
	remember: string[];
	core: string[];
	/** Memories to drop — matched by content in the store, not by id. */
	forget: string[];
	/** The reply text with all action tags removed. */
	cleaned: string;
}

function matches(raw: string, re: RegExp): string[] {
	const out: string[] = [];
	for (const m of raw.matchAll(re)) {
		const v = m[1]?.trim();
		if (v) out.push(v);
	}
	return out;
}

/** Pure: extract action tags and the cleaned text, with no side effects. */
export function parseActions(raw: string): ParsedActions {
	const cleaned = raw
		.replace(RE_REMEMBER, "")
		.replace(RE_CORE, "")
		.replace(RE_FORGET, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return {
		remember: matches(raw, RE_REMEMBER),
		core: matches(raw, RE_CORE),
		forget: matches(raw, RE_FORGET),
		cleaned,
	};
}
