/**
 * Telegram channel — a thin grammY adapter over `engine.respond`. It uses
 * long-polling (no public URL or webhook), so it runs from anywhere including
 * behind NAT. Responsibilities are kept to the edges: normalize text / voice /
 * photo into a neutral turn, batch quick bursts (batcher.ts), and send the
 * reply split into human-sized messages (split.ts). The engine stays
 * channel-agnostic. See docs/channels.md.
 */
import { Bot, type Context, InputFile } from "grammy";

import { sttConfigured, transcribe } from "#/channels/stt.ts";
import { synthesize, toOggOpus, ttsConfigured } from "#/channels/tts.ts";
import {
	type ReachOutDraft,
	respond,
	type Turn,
} from "#/companion-core/engine.ts";
import { saveUpload } from "#/companion-core/media.ts";
import { sanitizeForSpeech } from "#/companion-core/speak.ts";
import { config } from "#/config/index.ts";
import { Batcher, type BatchItem } from "./batcher.ts";
import { splitReply } from "./split.ts";

/** Telegram's typing indicator expires after ~5s, so refresh it under that. */
const TYPING_REFRESH_MS = 4000;
/** A small pause between split messages, so a multi-part reply feels typed. */
const SEND_GAP_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outbound = (draft: ReachOutDraft) => Promise<"text" | "voice" | null>;
/** Set once the bot is running; how a message the companion wrote first goes out. */
let outbound: Outbound | null = null;

/**
 * Deliver a message the companion decided to send first (see
 * companion-core/reach-out.ts) to the owner's private chat. Resolves to how it
 * went out, or null when Telegram isn't running or the send failed.
 */
export function sendToOwner(
	draft: ReachOutDraft,
): Promise<"text" | "voice" | null> {
	return outbound ? outbound(draft) : Promise.resolve(null);
}

/** Whether the Telegram channel is switched on (a bot token is present). */
export function telegramConfigured(): boolean {
	return !!config.telegram.botToken;
}

/** Download a Telegram file (by its resolved file_path) into raw bytes. */
async function downloadFile(filePath: string): Promise<Uint8Array> {
	const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`file download failed: ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/** Fold a batch of inbound items into one engine turn. */
function combine(items: BatchItem[]): Turn {
	const text = items
		.map((i) => i.text)
		.filter(Boolean)
		.join("\n");
	const images = items.flatMap((i) => i.images);
	const kind: Turn["kind"] = images.length
		? "photo"
		: items.some((i) => i.kind === "voice")
			? "voice"
			: "text";
	const mediaUrls = items.map((i) => i.mediaUrl).filter(Boolean) as string[];
	return {
		text,
		images: images.length ? images : undefined,
		kind,
		mediaUrl: mediaUrls.length ? mediaUrls.join("\n") : null,
	};
}

/**
 * Start the Telegram channel. No-op when no token is configured. Long-polling
 * runs for the life of the process, so this returns without awaiting it.
 */
export function startTelegram(): void {
	if (!telegramConfigured()) return;

	const allow = new Set(config.telegram.allowedUserIds);
	if (allow.size === 0) {
		console.warn(
			"[telegram] TELEGRAM_ALLOWED_USER_IDS is empty — every message will be ignored. Add your numeric Telegram ID.",
		);
	}

	const bot = new Bot(config.telegram.botToken);

	/**
	 * Keep a chat action alive (refreshed under Telegram's ~5s expiry) until the
	 * returned stop() is called. "typing" covers generation; "record_voice"
	 * covers synthesis, so the gap between a voice note in and a voice note out
	 * never goes quiet — the closest a Bot API integration gets to call-like
	 * feedback.
	 */
	function startAction(
		chatId: number,
		action: "typing" | "record_voice",
	): () => void {
		const tick = () => {
			bot.api.sendChatAction(chatId, action).catch(() => {});
		};
		tick();
		const timer = setInterval(tick, TYPING_REFRESH_MS);
		return () => clearInterval(timer);
	}

	/**
	 * Try to speak the reply as a Telegram voice note. Returns whether it sent —
	 * false (rather than throwing) on any synthesis/send failure, so the caller
	 * falls back to the ordinary text path exactly like a missing TTS backend.
	 */
	async function trySendVoice(chatId: number, reply: string): Promise<boolean> {
		const stopRecording = startAction(chatId, "record_voice");
		try {
			// Telegram draws the waveform only for OGG/Opus, so re-encode whatever
			// the provider returned (Piper writes wav).
			const audio = await toOggOpus(await synthesize(sanitizeForSpeech(reply)));
			await bot.api.sendVoice(chatId, new InputFile(audio, "reply.ogg"));
			return true;
		} catch (err) {
			console.error(
				"[telegram] voice send failed, falling back to text:",
				(err as Error).message,
			);
			return false;
		} finally {
			stopRecording();
		}
	}

	/** Send split text the way a reply goes out, with a typed feel between parts. */
	async function sendText(chatId: number, text: string): Promise<void> {
		const parts = splitReply(text, { paragraphs: config.telegram.replySplit });
		for (const [i, part] of parts.entries()) {
			await bot.api.sendMessage(chatId, part);
			if (i < parts.length - 1) await sleep(SEND_GAP_MS);
		}
	}

	// A private chat's id is the user's id, so the first allowlisted user is the
	// owner's chat. Nothing is sent anywhere else, ever.
	const ownerChat = config.telegram.allowedUserIds[0];
	outbound = async (draft) => {
		if (ownerChat == null) return null;
		try {
			if (draft.spoken && (await trySendVoice(ownerChat, draft.text)))
				return "voice";
			const stopTyping = startAction(ownerChat, "typing");
			await sleep(1500);
			stopTyping();
			await sendText(ownerChat, draft.text);
			return "text";
		} catch (err) {
			console.error(
				"[telegram] reach-out send failed:",
				(err as Error).message,
			);
			return null;
		}
	};

	async function handleBatch(
		chatId: number,
		items: BatchItem[],
	): Promise<void> {
		const turn = combine(items);
		if (!turn.text && !turn.images?.length) return;

		// Visibility that batching actually folded a burst: only the flush (not
		// each message) reaches here, and typing starts now — after the window —
		// never per-message.
		if (items.length > 1)
			console.log(`[telegram] batched ${items.length} messages into one turn`);

		const stopTyping = startAction(chatId, "typing");
		try {
			const { reply, spoken } = await respond(turn);
			stopTyping();

			if (spoken && ttsConfigured() && (await trySendVoice(chatId, reply)))
				return;

			if (
				!splitReply(reply, { paragraphs: config.telegram.replySplit }).length
			) {
				await bot.api.sendMessage(chatId, "…");
				return;
			}
			await sendText(chatId, reply);
		} catch (err) {
			console.error("[telegram] respond failed:", (err as Error).message);
			await bot.api
				.sendMessage(chatId, "Something went wrong on my end. Try me again.")
				.catch(() => {});
		} finally {
			stopTyping();
		}
	}

	const batcher = new Batcher(
		config.chat.batchIdleMs,
		config.chat.batchStepMs,
		config.chat.batchMaxMs,
		handleBatch,
	);

	// Allowlist gate: only configured user IDs get through; the rest are dropped.
	bot.use(async (ctx, next) => {
		const id = ctx.from?.id;
		if (id != null && allow.has(id)) await next();
	});

	bot.on("message:text", (ctx) => {
		batcher.add(ctx.chat.id, {
			text: ctx.message.text,
			images: [],
			kind: "text",
			mediaUrl: null,
		});
	});

	bot.on("message:photo", async (ctx) => {
		const chatId = ctx.chat.id;
		try {
			const sizes = ctx.message.photo;
			const largest = sizes[sizes.length - 1];
			if (!largest) return;
			const file = await ctx.api.getFile(largest.file_id);
			const bytes = file.file_path
				? await downloadFile(file.file_path)
				: new Uint8Array();
			const b64 = bytes.length ? Buffer.from(bytes).toString("base64") : "";
			// Save the photo so it redisplays in the web chat history too (Telegram
			// converts photos to JPEG); the base64 still feeds the model this turn.
			const mediaUrl = bytes.length ? await saveUpload(bytes, ".jpg") : null;
			batcher.add(chatId, {
				text: ctx.message.caption ?? "",
				images: b64 ? [b64] : [],
				kind: "photo",
				mediaUrl,
			});
		} catch (err) {
			console.error(
				"[telegram] photo handling failed:",
				(err as Error).message,
			);
		}
	});

	async function onVoice(ctx: Context): Promise<void> {
		const chatId = ctx.chat?.id;
		const fileId = ctx.message?.voice?.file_id ?? ctx.message?.audio?.file_id;
		if (chatId == null || !fileId) return;
		if (!sttConfigured()) {
			await ctx.reply(
				"I can't hear voice notes yet — set up speech-to-text (see the docs) or just text me.",
			);
			return;
		}
		try {
			const file = await ctx.api.getFile(fileId);
			if (!file.file_path) return;
			const bytes = await downloadFile(file.file_path);
			const transcript = await transcribe(bytes, "voice.ogg");
			if (!transcript) {
				await ctx.reply(
					"I couldn't make out that voice note — mind typing it?",
				);
				return;
			}
			batcher.add(chatId, {
				text: transcript,
				images: [],
				kind: "voice",
				mediaUrl: null,
			});
		} catch (err) {
			console.error(
				"[telegram] voice handling failed:",
				(err as Error).message,
			);
			await ctx
				.reply("I couldn't make out that voice note — mind typing it?")
				.catch(() => {});
		}
	}
	bot.on("message:voice", onVoice);
	bot.on("message:audio", onVoice);

	bot.catch((err) => {
		const cause = err.error;
		console.error(
			"[telegram] bot error:",
			cause instanceof Error ? cause.message : String(cause),
		);
	});

	bot
		.start({
			onStart: (me) => console.log(`[telegram] @${me.username} online`),
		})
		.catch((err) => {
			console.error("[telegram] failed to start:", (err as Error).message);
		});
}
