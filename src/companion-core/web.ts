/**
 * Bounded web access. The companion may end a reply with `<search>query</search>`
 * or `<fetch>url</fetch>`; the engine runs them, feeds the results back, and lets
 * it answer for real. A deliberate, optional, bounded exception to the otherwise
 * no-egress design — see docs/web-access.md and
 * docs/decisions/bounded-web-access.md.
 *
 * Search uses Tavily when configured (built for LLMs), else scrapes DuckDuckGo's
 * HTML endpoint with no key so it works out of the box. Page reads are a direct
 * fetch + a crude HTML→text strip (no new dependency). Everything degrades to a
 * short note rather than throwing, so a flaky lookup never breaks a turn.
 */
import { config } from "#/config/index.ts";

const UA =
	"Mozilla/5.0 (compatible; personal-companion/1.0; +https://github.com/carbongo/personal-companion)";

/** Whether the companion's web tags should be honored at all. */
export function webConfigured(): boolean {
	return config.web.enabled;
}

export interface WebRequest {
	kind: "search" | "fetch";
	value: string;
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

const RE_SEARCH = /<search>([\s\S]*?)<\/search>/gi;
const RE_FETCH = /<fetch>([\s\S]*?)<\/fetch>/gi;

/** Pull web tags out of a reply. Deduped and capped per round. */
export function extractWebRequests(raw: string): WebRequest[] {
	const out: WebRequest[] = [];
	const seen = new Set<string>();
	const push = (kind: WebRequest["kind"], value: string) => {
		const v = value.trim();
		if (!v) return;
		const key = `${kind}:${v}`;
		if (seen.has(key)) return;
		seen.add(key);
		out.push({ kind, value: v });
	};
	for (const m of raw.matchAll(RE_SEARCH)) push("search", m[1] ?? "");
	for (const m of raw.matchAll(RE_FETCH)) push("fetch", m[1] ?? "");
	return out.slice(0, config.web.maxRequestsPerStep);
}

/** Remove web tags so they never reach the user if one survives to the reply. */
export function stripWebTags(raw: string): string {
	return raw
		.replace(RE_SEARCH, "")
		.replace(RE_FETCH, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Every http(s) URL mentioned in a blob of text (trailing punctuation trimmed). */
export function extractUrls(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
		const u = m[0].replace(/[).,;!?]+$/, "");
		if (!out.includes(u)) out.push(u);
	}
	return out;
}

/**
 * Small models retype a link the owner shared and often mangle its casing or tail,
 * so a `<fetch>` 404s on the owner's own page. If a requested URL matches one the
 * owner actually sent (case-insensitively, ignoring a trailing slash), fetch the
 * owner's exact URL instead. A genuinely new URL the model found is left alone.
 */
export function snapToUserUrl(requested: string, userUrls: string[]): string {
	const norm = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");
	const want = norm(requested);
	return userUrls.find((u) => norm(u) === want) ?? requested;
}

/** Run a round of requests concurrently and format one text block to feed back. */
export async function runWebRequests(
	reqs: WebRequest[],
	userUrls: string[] = [],
): Promise<string> {
	const blocks = await Promise.all(
		reqs.map(async (r) => {
			try {
				if (r.kind === "search") {
					console.log(`[companion] web search: ${JSON.stringify(r.value)}`);
					const results = await webSearch(r.value);
					if (!results.length) return `SEARCH "${r.value}": no results.`;
					const lines = results.map(
						(x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`,
					);
					return `SEARCH "${r.value}":\n${lines.join("\n")}`;
				}
				const url = snapToUserUrl(r.value, userUrls);
				console.log(`[companion] web fetch: ${url}`);
				const page = await fetchPage(url);
				return `PAGE ${page.url}${page.title ? ` — ${page.title}` : ""}:\n${page.text}`;
			} catch (err) {
				const msg = (err as Error).message || "lookup failed";
				return `${r.kind.toUpperCase()} "${r.value}": couldn't (${msg}).`;
			}
		}),
	);
	return blocks.join("\n\n");
}

// --- search ------------------------------------------------------------------

/** Top web results: Tavily if keyed and selected, else DuckDuckGo scrape. */
export async function webSearch(query: string): Promise<SearchResult[]> {
	if (config.web.searchProvider === "tavily" && config.web.tavilyKey) {
		try {
			return await tavilySearch(query);
		} catch (err) {
			console.error(
				"[companion] tavily failed, falling back to ddg:",
				(err as Error).message,
			);
		}
	}
	return duckduckgoSearch(query);
}

async function tavilySearch(query: string): Promise<SearchResult[]> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${config.web.tavilyKey}`,
		},
		body: JSON.stringify({
			query,
			max_results: config.web.results,
			search_depth: "basic",
			include_answer: true,
		}),
		signal: AbortSignal.timeout(config.web.searchTimeoutMs),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`tavily ${res.status}: ${body.slice(0, 160)}`);
	}
	const data = (await res.json()) as {
		answer?: string;
		results?: Array<{ title?: string; url?: string; content?: string }>;
	};
	const results: SearchResult[] = [];
	if (data.answer?.trim())
		results.push({
			title: "Quick answer",
			url: "",
			snippet: clip(data.answer, 400),
		});
	for (const r of data.results ?? []) {
		if (!r.url) continue;
		results.push({
			title: (r.title || r.url).trim(),
			url: r.url,
			snippet: clip(r.content || "", 320),
		});
	}
	return results.slice(0, config.web.results + 1);
}

/**
 * No-key fallback: scrape DuckDuckGo's HTML endpoint. Brittle by nature, so it's
 * wrapped in tolerant parsing and only returns what it can confidently read.
 */
async function duckduckgoSearch(query: string): Promise<SearchResult[]> {
	const res = await fetch("https://html.duckduckgo.com/html/", {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			"user-agent": UA,
		},
		body: new URLSearchParams({ q: query }).toString(),
		signal: AbortSignal.timeout(config.web.searchTimeoutMs),
	});
	if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
	const html = await res.text();
	const out: SearchResult[] = [];
	const re =
		/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	for (const m of html.matchAll(re)) {
		const url = ddgUnwrap(decodeEntities(m[1] ?? ""));
		const title = htmlToText(m[2] ?? "");
		if (!url || !title) continue;
		out.push({ title, url, snippet: "" });
		if (out.length >= config.web.results) break;
	}
	const snippets = [
		...html.matchAll(
			/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
		),
	].map((m) => htmlToText(m[1] ?? ""));
	out.forEach((r, i) => {
		const s = snippets[i];
		if (s) r.snippet = clip(s, 320);
	});
	return out;
}

/** DDG result links are wrapped in a redirect carrying the real URL in `uddg`. */
function ddgUnwrap(href: string): string {
	try {
		const u = new URL(href, "https://duckduckgo.com");
		const target = u.searchParams.get("uddg");
		return target ? target : u.toString();
	} catch {
		return href.startsWith("http") ? href : "";
	}
}

// --- page read ---------------------------------------------------------------

/** Fetch a single page and return a trimmed, readable text extract. */
export async function fetchPage(
	rawUrl: string,
): Promise<{ title: string; text: string; url: string }> {
	const url = normalizeUrl(rawUrl);
	guardUrl(url);
	const res = await fetch(url, {
		headers: { "user-agent": UA, accept: "text/html,*/*" },
		redirect: "follow",
		signal: AbortSignal.timeout(config.web.fetchTimeoutMs),
	});
	if (!res.ok) throw new Error(`http ${res.status}`);
	guardUrl(res.url || url); // re-guard the final URL after redirects
	const ctype = res.headers.get("content-type") || "";
	const body = await res.text();
	if (/json/i.test(ctype) && !/html/i.test(ctype))
		return {
			title: "",
			text: clip(body, config.web.pageChars),
			url: res.url || url,
		};
	const title = htmlToText(
		(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "",
	);
	const text = htmlToText(body);
	if (!text) throw new Error("nothing readable on the page");
	return {
		title: clip(title, 200),
		text: clip(text, config.web.pageChars),
		url: res.url || url,
	};
}

function normalizeUrl(raw: string): string {
	const v = raw.trim().replace(/[).,]+$/, "");
	const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
	return redditToOld(withProto);
}

/** old.reddit.com returns server-rendered HTML; www.reddit serves a JS challenge. */
function redditToOld(raw: string): string {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return raw;
	}
	const host = u.hostname.toLowerCase();
	if (host === "reddit.com" || host.endsWith(".reddit.com")) {
		u.hostname = "old.reddit.com";
		return u.toString();
	}
	return raw;
}

/**
 * Keep page reads pointed at the public internet: block localhost / private /
 * link-local / tailnet targets so a shared link can't poke internal services
 * (including a local model endpoint). See docs/security.md.
 */
export function guardUrl(raw: string): void {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		throw new Error("not a url");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:")
		throw new Error("only http(s)");
	const host = u.hostname.toLowerCase();
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".internal") ||
		host.endsWith(".ts.net")
	)
		throw new Error("internal host");
	const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (m) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		const priv =
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127);
		if (priv) throw new Error("private address");
	}
	if (
		host === "::1" ||
		host.startsWith("fe80") ||
		host.startsWith("fc") ||
		host.startsWith("fd")
	)
		throw new Error("private address");
}

// --- html → text -------------------------------------------------------------

function htmlToText(html: string): string {
	let s = html;
	s = s.replace(/<!--[\s\S]*?-->/g, " ");
	s = s.replace(
		/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi,
		" ",
	);
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(
		/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|header|footer|nav)>/gi,
		"\n",
	);
	s = s.replace(/<[^>]+>/g, " ");
	s = decodeEntities(s);
	s = s
		.replace(/[ \t\f\v\r]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return s;
}

const NAMED: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	"#39": "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, body: string) => {
		const b = body.toLowerCase();
		if (b[0] === "#") {
			const code =
				b[1] === "x" ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return NAMED[b] ?? whole;
	});
}

function clip(s: string, n: number): string {
	const t = s.trim();
	return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}
