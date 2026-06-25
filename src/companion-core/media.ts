/**
 * Attachment storage. Images sent to the companion — web chat uploads/pastes and
 * Telegram photos — are written under `DATA_DIR/uploads` and referenced by a
 * `/uploads/<file>` path on the message row (`media_url`), so they redisplay in
 * the chat history. The web layer serves them back through the auth-gated
 * `/uploads` route (see src/server/web/index.tsx). See docs/data-model.md.
 */
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { config } from "#/config/index.ts";

/** Where attachments live: under DATA_DIR, or a temp dir for the in-memory DB. */
export function uploadsDir(): string {
	return config.app.dataDir === ":memory:"
		? join(tmpdir(), "companion-uploads")
		: join(config.app.dataDir, "uploads");
}

/** A short extension like ".png" is safe; anything else is dropped. */
const SAFE_EXT = /^\.[a-z0-9]{1,8}$/;

const MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".ogg": "audio/ogg",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".wav": "audio/wav",
	".webm": "audio/webm",
};

/** Lowercase extension (with dot) of a name, or "" when absent/unsafe. */
export function extOf(name: string): string {
	const i = name.lastIndexOf(".");
	if (i < 0) return "";
	const ext = name.slice(i).toLowerCase();
	return SAFE_EXT.test(ext) ? ext : "";
}

/** Content-type to serve a stored attachment by, by its extension. */
export function contentTypeFor(name: string): string {
	return MIME[extOf(name)] ?? "application/octet-stream";
}

/** Guess an image extension from the leading magic bytes (default ".jpg"). */
export function sniffImageExt(b: Uint8Array): string {
	if (
		b.length >= 4 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47
	)
		return ".png";
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		return ".jpg";
	if (
		b.length >= 4 &&
		b[0] === 0x47 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x38
	)
		return ".gif";
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	)
		return ".webp";
	return ".jpg";
}

/** A collision-resistant filename keeping a safe extension. */
function uniqueName(ext: string): string {
	const e = SAFE_EXT.test(ext) ? ext : "";
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${e}`;
}

/**
 * Persist attachment bytes and return the public `/uploads/<file>` path to store
 * as a message's `media_url`. Best-effort: a write failure returns null so a turn
 * never breaks just because an attachment couldn't be saved.
 */
export async function saveUpload(
	bytes: Uint8Array,
	ext: string,
): Promise<string | null> {
	try {
		const dir = uploadsDir();
		mkdirSync(dir, { recursive: true });
		const name = uniqueName(ext.toLowerCase());
		await Bun.write(join(dir, name), bytes);
		return `/uploads/${name}`;
	} catch {
		return null;
	}
}

/**
 * Resolve a `/uploads/<file>` name to an absolute path for serving, refusing path
 * traversal: only a bare basename that actually exists in the uploads dir passes.
 */
export function resolveUpload(name: string): string | null {
	if (!name || basename(name) !== name) return null;
	const path = join(uploadsDir(), name);
	return existsSync(path) ? path : null;
}
