/**
 * One-off: run the weekly memory consolidation once against the live DATA_DIR
 * database and print what it changed. Back up first. Reads the last week of
 * daily summaries + current memories; saves/edits via the same machinery the
 * scheduler uses. See docs/memory.md.
 */
import { sql } from "drizzle-orm";

import { weeklyConsolidate } from "#/companion-core/memory/rollup.ts";
import { listMemories } from "#/companion-core/memory/store.ts";
import { db } from "#/db/index.ts";
import { provider } from "#/llm/index.ts";

try {
	db.run(sql`PRAGMA busy_timeout = 5000`);
} catch {
	// best-effort
}

const brain = provider.describe();
console.log(
	`[weekly] brain: ${brain.provider}/${brain.model}` +
		(brain.endpoint ? ` @ ${brain.endpoint}` : ""),
);
if (!(await provider.reachable())) {
	console.error(
		"[weekly] model unreachable — start it and re-run. Nothing changed.",
	);
	process.exit(1);
}

const before = listMemories(1000).map((m) => m.content);
console.log(`\n[weekly] ${before.length} memor(y/ies) before:`);
for (const c of before.slice().reverse()) console.log(`  • ${c}`);

console.log("\n[weekly] consolidating…");
const { saved, forgotten } = await weeklyConsolidate();
console.log(
	`\n[weekly] +${saved.length} saved, -${forgotten.length} forgotten`,
);
for (const f of forgotten) console.log(`  - ${f}`);
for (const f of saved) console.log(`  + ${f}`);

const after = listMemories(1000).map((m) => m.content);
console.log(`\n[weekly] ${after.length} memor(y/ies) now:`);
for (const c of after.slice().reverse()) console.log(`  • ${c}`);
process.exit(0);
