/**
 * Context assembly, split for token frugality:
 *
 *  - buildKnowledge() — semi-stable (Core, saved memories, recent daily summaries,
 *    the companion's note titles). Goes in the cached system prefix so a local
 *    model reuses its KV cache across turns and only reprocesses it when it
 *    actually changes.
 *  - buildVolatile() — the small per-turn delta (date/time, current weather) that
 *    rides on the latest user message only, never stored, so the cached prefix
 *    stays byte-stable.
 *
 * See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import {
	getCore,
	listMemories,
	listNoteTitles,
	recentSummariesBefore,
	todayKey,
} from "./memory/store.ts";
import { getWeather, weatherDescription } from "./providers/weather.ts";

function nowLine(tz: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date());
}

async function weatherLine(): Promise<string | null> {
	const w = await getWeather();
	if (!w) return null;
	const range = w.today ? `, today ${w.today.tMin}°/${w.today.tMax}°` : "";
	return `${w.location}: ${w.current.temp}° ${weatherDescription(
		w.current.code,
	)}, wind ${w.current.wind} km/h${range}`;
}

/** Semi-stable knowledge for the cached system prefix. */
export function buildKnowledge(): string {
	const parts: string[] = [];

	const core = getCore().trim();
	if (core) parts.push(`## Your Core (the spine of the two of you)\n${core}`);

	const memories = listMemories(config.memory.memoryLimit);
	if (memories.length) {
		const lines = memories
			.slice()
			.reverse()
			.map((m) => `- ${m.content}${m.tags ? `  [${m.tags}]` : ""}`);
		parts.push(`## Things you've saved\n${lines.join("\n")}`);
	}

	const summaries = recentSummariesBefore(
		todayKey(),
		config.memory.contextDays,
	);
	if (summaries.length) {
		const lines = summaries.map((s) => `### ${s.day}\n${s.summaryMd}`);
		parts.push(`## Recent days (your summaries)\n${lines.join("\n\n")}`);
	}

	if (config.memory.noteTitles > 0) {
		const titles = listNoteTitles(config.memory.noteTitles);
		if (titles.length)
			parts.push(
				`## Notes you've filed (titles)\n${titles.map((t) => `- ${t}`).join("\n")}`,
			);
	}

	return parts.join("\n\n");
}

/** The small per-turn delta that rides on the latest user message. */
export async function buildVolatile(): Promise<string> {
	const tz = config.app.timezone;
	const parts = [`Now: ${nowLine(tz)} (${tz})`];
	const weather = await weatherLine();
	if (weather) parts.push(`Weather: ${weather}`);
	return parts.join("\n");
}
