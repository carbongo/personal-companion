/**
 * Conversational movement — the small computed read of how the exchange is
 * actually going, handed to the companion as a note on its own turn.
 *
 * A model with the day's transcript in front of it has no sense of *momentum*:
 * every turn looks like a fresh chance to raise the thing it raised last time,
 * so it circles — re-asking about a topic the owner quietly dropped, ending
 * every message with a question, or reflecting the owner's own words back with
 * nothing added. Asking the model to notice this about itself doesn't work; a
 * small local model is the last thing that can audit its own output.
 *
 * So it's measured here, in plain code, from the messages already in hand, and
 * only when a threshold is crossed does a short note ride along with the turn.
 * Silence is the normal case — a healthy conversation adds nothing to the
 * prompt. See docs/conversation-dynamics.md.
 */
import { config } from "#/config/index.ts";

/** The shape this reads — the stored message row, narrowed to what it needs. */
export interface Exchange {
	role: "user" | "assistant";
	content: string;
}

/** How many of the companion's recent messages count as "lately". */
const LATELY = 3;
/** A topic must appear in at least this many of them to count as circling. */
const REPEATS = 2;
/** How many of the owner's recent messages count as "they're still on it". */
const OWNER_WINDOW = 2;
/** Consecutive companion messages ending in a question before it's nagging. */
const QUESTION_STREAK = 3;
/** How much of a reply can be the owner's own words before it's a mirror. */
const ECHO_RATIO = 0.6;
/** Below this a message is too short to judge for echoing. */
const ECHO_MIN_WORDS = 6;
/** At most this many topics are named in the note — one line, not a list. */
const MAX_TOPICS = 2;

/**
 * Words that carry no topic. Deliberately broad (it includes conversational
 * verbs like "think" and "feel"): a missed signal is invisible, while a note
 * telling the companion to drop "think" is nonsense it would have to obey.
 */
const STOPWORDS = new Set(
	`a about above after again against all also always am an and another any anything are aren't
	around as ask asked at away back be because been before being below best better between both
	but by came can can't cannot come coming could couldn't course did didn't do does doesn't
	doing don't done down during each else enough even ever every everything far feel feeling
	feels felt few find for from get gets getting give given go goes going gone good got great
	guess had hadn't happen happened has hasn't have haven't having he her here hers herself him
	himself his how however i i'd i'll i'm i've if in into is isn't it it's its itself just keep
	kept know knew known let like little long look looked looking lot made make makes making many
	maybe me mean means might mine more most much must my myself need needed never new next nice
	no nor not nothing now of off often oh ok okay on once one only or other others ought our ours
	ourselves out over own people perhaps please pretty put quite rather really right said same
	saw say saying says see seem seemed seems seen she should shouldn't since so some someone
	something sometimes soon sorry sound sounds still such sure take taken talk talked talking
	tell telling than that that's the their theirs them themselves then there these they thing
	things think thinking thought this those though through time to today together too took
	tomorrow took true try trying two under until up upon us use used usually very want wanted
	was wasn't way we well went were weren't what whatever when where whether which while who
	whole whom why will with within without won't wonder would wouldn't yeah year years yes yet
	you you're your yours yourself yourselves`
		.split(/\s+/)
		.filter(Boolean),
);

/**
 * Loosely normalize a word so "workout" and "workouts" are one topic. A single
 * trailing "s" is dropped on longer words only, so "gas" and "his" survive.
 */
function normalize(word: string): string {
	const w = word.replace(/['’]s$/, "");
	return w.length > 4 && w.endsWith("s") && !w.endsWith("ss")
		? w.slice(0, -1)
		: w;
}

/** The topic-bearing words of a message: normalized, stopwords and names out. */
export function contentWords(text: string): Set<string> {
	const names = new Set(
		[config.app.name, config.app.owner]
			.join(" ")
			.toLowerCase()
			.split(/\W+/)
			.filter(Boolean)
			.map(normalize),
	);
	const out = new Set<string>();
	for (const raw of text.toLowerCase().split(/[^a-z0-9'’-]+/)) {
		if (raw.length < 4 || STOPWORDS.has(raw)) continue;
		const w = normalize(raw);
		if (w.length < 4 || STOPWORDS.has(w) || names.has(w)) continue;
		out.add(w);
	}
	return out;
}

const lastOf = (
	xs: Exchange[],
	role: Exchange["role"],
	n: number,
): Exchange[] => xs.filter((m) => m.role === role).slice(-n);

/**
 * Topics the companion keeps bringing up that the owner has stopped answering:
 * present in `REPEATS` of its last `LATELY` messages *and* in its most recent
 * one (so it's still pushing now), absent from the owner's last `OWNER_WINDOW`.
 * Ranked by how often the companion has raised it.
 */
export function clingingTopics(messages: Exchange[]): string[] {
	const mine = lastOf(messages, "assistant", LATELY);
	if (mine.length < REPEATS) return [];
	const latest = mine[mine.length - 1];
	if (!latest) return [];

	const still = contentWords(latest.content);
	const theirs = new Set<string>();
	for (const m of lastOf(messages, "user", OWNER_WINDOW))
		for (const w of contentWords(m.content)) theirs.add(w);

	const counts = new Map<string, number>();
	for (const m of mine)
		for (const w of contentWords(m.content))
			if (still.has(w) && !theirs.has(w))
				counts.set(w, (counts.get(w) ?? 0) + 1);

	return [...counts.entries()]
		.filter(([, n]) => n >= REPEATS)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_TOPICS)
		.map(([w]) => w);
}

/** How many of the companion's messages, counting back, ended in a question. */
export function questionStreak(messages: Exchange[]): number {
	let streak = 0;
	for (const m of messages.filter((x) => x.role === "assistant").reverse()) {
		if (!m.content.trim().endsWith("?")) break;
		streak++;
	}
	return streak;
}

/**
 * Whether the companion's last message was mostly the owner's own words handed
 * back — a long enough reply in which `ECHO_RATIO` of the topic words came
 * straight from what the owner had just said.
 */
export function isEchoing(messages: Exchange[]): boolean {
	const i = messages.map((m) => m.role).lastIndexOf("assistant");
	const mine = messages[i];
	if (!mine) return false;
	const theirs = messages
		.slice(0, i)
		.reverse()
		.find((m) => m.role === "user");
	if (!theirs) return false;

	const words = contentWords(mine.content);
	if (words.size < ECHO_MIN_WORDS) return false;
	const said = contentWords(theirs.content);
	let echoed = 0;
	for (const w of words) if (said.has(w)) echoed++;
	return echoed / words.size >= ECHO_RATIO;
}

/**
 * The note that rides along with the turn, or "" when the conversation is
 * moving fine — which is most of the time, so the prompt normally grows by
 * nothing at all.
 */
export function buildConversationNote(messages: Exchange[]): string {
	const owner = config.app.owner;
	const lines: string[] = [];

	const clinging = clingingTopics(messages);
	if (clinging.length) {
		const list = clinging.map((t) => `"${t}"`).join(" and ");
		lines.push(
			`You keep coming back to ${list}, and ${owner} hasn't picked it up. That's their answer. ` +
				`Let it go — don't raise it again, don't check in on it, don't work it into something else. ` +
				`Say what's on your own mind instead, or follow where ${owner} actually is.`,
		);
	}

	if (questionStreak(messages) >= QUESTION_STREAK)
		lines.push(
			`You've ended your last several messages with a question. Stop asking. ` +
				`Say something of your own this time and leave it there.`,
		);

	if (isEchoing(messages))
		lines.push(
			`Your last message was mostly ${owner}'s own words handed back. That isn't company. ` +
				`Add something they didn't say — what you make of it, where you'd push back, ` +
				`something it reminded you of.`,
		);

	if (!lines.length) return "";
	return (
		`[how this is going — your own read, not ${owner}'s words]\n` +
		`${lines.join("\n")}\n[end]`
	);
}
