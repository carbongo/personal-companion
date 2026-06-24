/**
 * Outgoing reply-splitting. Telegram caps a message at 4096 characters, and a
 * wall of text feels robotic — so a long reply is sent as paragraph-sized
 * messages, like a person texting. This module is pure (no network) so it is
 * easy to test; the channel just sends each returned chunk in order.
 */

/** Telegram's hard per-message limit; we stay a little under it. */
const TELEGRAM_MAX = 4096;
const SAFE_MAX = 4000;

/** Break one over-long string into pieces of at most `maxLen`, preferring a
 * newline, then a space, before resorting to a hard cut. */
function hardWrap(text: string, maxLen: number): string[] {
	const out: string[] = [];
	let rest = text;
	while (rest.length > maxLen) {
		const window = rest.slice(0, maxLen);
		let cut = window.lastIndexOf("\n");
		if (cut < maxLen * 0.5) cut = window.lastIndexOf(" ");
		if (cut < maxLen * 0.5) cut = maxLen;
		out.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) out.push(rest);
	return out;
}

export interface SplitOptions {
	/** Send each paragraph as its own message (true) or as one message (false). */
	paragraphs: boolean;
	/** Override the per-message character ceiling (defaults to Telegram's). */
	maxLen?: number;
}

/**
 * Split a reply into the sequence of messages to send. With `paragraphs`,
 * blank-line-separated blocks become separate messages; without it, the whole
 * reply is one message. Either way, no returned chunk exceeds the limit.
 */
export function splitReply(text: string, opts: SplitOptions): string[] {
	const maxLen = Math.min(opts.maxLen ?? SAFE_MAX, TELEGRAM_MAX);
	const trimmed = text.trim();
	if (!trimmed) return [];

	const blocks = opts.paragraphs
		? trimmed
				.split(/\n\s*\n/)
				.map((b) => b.trim())
				.filter(Boolean)
		: [trimmed];

	return blocks.flatMap((b) => (b.length > maxLen ? hardWrap(b, maxLen) : [b]));
}
