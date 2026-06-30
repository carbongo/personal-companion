/**
 * One-off maintenance: retroactively reconcile long-term memory against every
 * past day, oldest first — the same pass the nightly roll-up now runs, applied
 * to history. Reads/writes the live DATA_DIR database, so back up first
 * (`VACUUM INTO`). Resilient: a day that errors is logged and skipped, never
 * fatal, and the whole thing is re-runnable (adds de-dupe, forgets are
 * conservative). See docs/memory.md.
 */
import { sql } from "drizzle-orm";

import { reconcileMemories } from "#/companion-core/memory/rollup.ts";
import {
	distinctMessageDays,
	listMemories,
	messagesForDay,
} from "#/companion-core/memory/store.ts";
import { db } from "#/db/index.ts";
import { provider } from "#/llm/index.ts";

// Be patient if the running server happens to write at the same instant.
try {
	db.run(sql`PRAGMA busy_timeout = 5000`);
} catch {
	// pragma is best-effort; contention is effectively nil for this run
}

const brain = provider.describe();
console.log(
	`[reconcile] brain: ${brain.provider}/${brain.model}` +
		(brain.endpoint ? ` @ ${brain.endpoint}` : ""),
);

if (!(await provider.reachable())) {
	console.error(
		"[reconcile] model unreachable — start it and re-run. Nothing changed.",
	);
	process.exit(1);
}

const days = distinctMessageDays(); // oldest first
console.log(
	`[reconcile] ${days.length} day(s) to process; ` +
		`${listMemories(1000).length} memor(y/ies) before.`,
);

let totalSaved = 0;
let totalForgotten = 0;
let failed = 0;

for (const [i, day] of days.entries()) {
	const msgs = messagesForDay(day);
	console.log(`\n[${i + 1}/${days.length}] ${day} (${msgs.length} msgs)…`);
	try {
		const { saved, forgotten } = await reconcileMemories(day, msgs);
		totalSaved += saved.length;
		totalForgotten += forgotten.length;
		console.log(`  → +${saved.length} saved / -${forgotten.length} forgotten`);
		for (const f of saved) console.log(`    + ${f}`);
		for (const f of forgotten) console.log(`    - ${f}`);
	} catch (err) {
		failed++;
		console.log(`  → ERROR (skipped): ${(err as Error).message}`);
	}
}

const after = listMemories(1000);
console.log(
	`\n[reconcile] done. +${totalSaved} saved, -${totalForgotten} forgotten, ` +
		`${failed} day(s) errored.`,
);
console.log(`[reconcile] ${after.length} memor(y/ies) now:`);
for (const m of after.slice().reverse()) console.log(`  • ${m.content}`);
process.exit(0);
