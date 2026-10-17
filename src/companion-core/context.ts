/**
 * Context assembly, split for token frugality:
 *
 *  - buildKnowledge() — semi-stable (Core, saved memories, recent daily
 *    summaries, and week/month digests for the time before them). Goes in the cached system prefix so a local model reuses its KV
 *    cache across turns and only reprocesses it when it actually changes.
 *  - buildVolatile() — the small per-turn delta (date/time, time apart, weather) that
 *    rides on the latest user message only, never stored, so the cached prefix
 *    stays byte-stable.
 *
 * See docs/memory.md.
 */
import { config } from "#/config/index.ts";
import { selectDigests } from "./memory/digest.ts";
import {
	dayKey,
	getCore,
	latestMessages,
	listDigests,
	listMemories,
	recentSummariesBefore,
	todayKey,
} from "./memory/store.ts";
import { getWeather, weatherDescription } from "./providers/weather.ts";
import { timeNote } from "./time.ts";

/** How far back to look for the start of the current conversation. */
const SITTING_SCAN = 200;

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

	const tz = config.app.timezone;
	const memories = listMemories(config.memory.memoryLimit);
	if (memories.length) {
		// Each fact carries the day it was last known true — a date, not "N days
		// ago", so this prefix stays byte-stable from one day to the next.
		const lines = memories
			.slice()
			.reverse()
			.map(
				(m) =>
					`- ${m.content}${m.tags ? `  [${m.tags}]` : ""}  (as of ${dayKey(
						m.confirmedAt ?? m.createdAt,
						tz,
					)})`,
			);
		parts.push(`## Things you've saved\n${lines.join("\n")}`);
	}

	const summaries = recentSummariesBefore(
		todayKey(),
		config.memory.contextDays,
	);
	if (config.memory.digests) {
		const { weeks, months } = selectDigests(
			summaries[0]?.day ?? todayKey(),
			listDigests("week"),
			listDigests("month"),
			config.memory.contextWeeks,
			config.memory.contextMonths,
		);
		if (months.length) {
			const lines = months.map(
				(d) => `### ${d.start.slice(0, 7)}\n${d.summaryMd}`,
			);
			parts.push(`## Further back, month by month\n${lines.join("\n\n")}`);
		}
		if (weeks.length) {
			const lines = weeks.map(
				(d) => `### ${d.start} to ${d.end}\n${d.summaryMd}`,
			);
			parts.push(`## Earlier weeks\n${lines.join("\n\n")}`);
		}
	}
	if (summaries.length) {
		const lines = summaries.map((s) => `### ${s.day}\n${s.summaryMd}`);
		parts.push(`## Recent days (your summaries)\n${lines.join("\n\n")}`);
	}

	return parts.join("\n\n");
}

/** The small per-turn delta that rides on the latest user message. */
export async function buildVolatile(): Promise<string> {
	const tz = config.app.timezone;
	const parts = [`Now: ${nowLine(tz)} (${tz})`];
	const apart = timeNote(latestMessages(SITTING_SCAN), new Date(), tz);
	if (apart) parts.push(apart);
	const weather = await weatherLine();
	if (weather) parts.push(`Weather: ${weather}`);
	return parts.join("\n");
}
