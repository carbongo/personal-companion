/**
 * Minimal `.env` writer for the setup wizard. The app is env-driven (see
 * src/config/), so the first-run wizard's job is to produce a `.env` the owner
 * can keep. We merge in place: existing keys are updated where they sit, new
 * keys are appended, and every other line (comments, untouched keys, blanks) is
 * preserved. Values that need it are quoted. `.env` is gitignored, so this only
 * ever writes a user's local, private file.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** A value that is safe to write bare; anything else gets double-quoted. */
const BARE = /^[A-Za-z0-9_./:@,+-]*$/;

function quote(value: string): string {
	if (value === "" || BARE.test(value)) return value;
	const escaped = value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n");
	return `"${escaped}"`;
}

function keyOf(line: string): string | null {
	const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
	return m ? (m[1] ?? null) : null;
}

/**
 * Apply `updates` to the contents of an env file. Keys mapped to `undefined`
 * are left untouched (so a blank optional field never clobbers an existing
 * value); keys mapped to a string — including `""` — are written. Pure: no I/O.
 */
export function serializeEnvUpdates(
	existing: string,
	updates: Record<string, string | undefined>,
): string {
	const pending = new Map<string, string>();
	for (const [k, v] of Object.entries(updates))
		if (v !== undefined) pending.set(k, v);

	const lines = existing === "" ? [] : existing.split("\n");
	const out = lines.map((line) => {
		const key = keyOf(line);
		if (key && pending.has(key)) {
			const value = pending.get(key) ?? "";
			pending.delete(key);
			return `${key}=${quote(value)}`;
		}
		return line;
	});

	// Append any keys that weren't already present, after a single blank line.
	const appended = [...pending].map(([k, v]) => `${k}=${quote(v)}`);
	if (appended.length) {
		if (out.length && out[out.length - 1]?.trim() !== "") out.push("");
		out.push(...appended);
	}

	let text = out.join("\n");
	if (!text.endsWith("\n")) text += "\n";
	return text;
}

/** Read `path` (treating a missing file as empty), merge `updates`, write back. */
export function writeEnvFile(
	path: string,
	updates: Record<string, string | undefined>,
): void {
	let existing = "";
	try {
		existing = readFileSync(path, "utf8");
	} catch {
		// no file yet — start from empty
	}
	writeFileSync(path, serializeEnvUpdates(existing, updates), "utf8");
}
