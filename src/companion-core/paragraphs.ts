/**
 * Incremental paragraph splitting for streamed replies. As a model streams
 * tokens, the web chat sends each finished paragraph as its own message (like a
 * person texting, and matching the Telegram reply-split). A paragraph is "done"
 * the moment a blank line follows it, so we can flush it without waiting for the
 * whole reply. Pure and stateless — the caller owns the rolling buffer. See
 * docs/channels.md.
 */

/** A blank line separates paragraphs (same rule as the Telegram split). */
const SEP = /\n\s*\n/;

/**
 * Pull every complete paragraph out of `buffer`, returning them and whatever
 * tail remains (the in-progress paragraph, kept for the next chunk). A paragraph
 * is complete once a blank line follows it; the trailing text is never emitted
 * here so a half-written paragraph isn't sent early.
 */
export function takeParagraphs(buffer: string): {
	paragraphs: string[];
	rest: string;
} {
	const paragraphs: string[] = [];
	let rest = buffer;
	let m = SEP.exec(rest);
	while (m) {
		paragraphs.push(rest.slice(0, m.index));
		rest = rest.slice(m.index + m[0].length);
		m = SEP.exec(rest);
	}
	return { paragraphs, rest };
}
