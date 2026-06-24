/**
 * Speech-to-text for voice notes. Pluggable and optional: "off" (default),
 * "openai" (the hosted Whisper API), or "whisper-http" (any OpenAI-compatible
 * `/audio/transcriptions` endpoint — e.g. a local faster-whisper server). The
 * channel calls `transcribe()` to turn audio bytes into a text turn; the engine
 * never knows the input arrived as voice. See docs/configuration.md.
 */
import { config } from "#/config/index.ts";

const OPENAI_TRANSCRIPTIONS = "https://api.openai.com/v1/audio/transcriptions";

/** Whether voice transcription is set up; if false the channel asks for text. */
export function sttConfigured(): boolean {
	const { provider, apiUrl } = config.stt;
	if (provider === "openai") return !!config.stt.apiKey;
	if (provider === "whisper-http") return !!apiUrl;
	return false;
}

/** Resolve the transcription endpoint for the configured provider. */
function endpoint(): string {
	if (config.stt.provider === "openai") return OPENAI_TRANSCRIPTIONS;
	return config.stt.apiUrl;
}

/**
 * Transcribe audio bytes to text. Throws on a transport or API error so the
 * caller can fall back to a friendly "I couldn't make that out" message.
 */
export async function transcribe(
	bytes: Uint8Array,
	filename: string,
): Promise<string> {
	if (!sttConfigured()) throw new Error("STT is not configured");

	const form = new FormData();
	form.append("file", new Blob([bytes]), filename);
	form.append("model", config.stt.model);

	const headers: Record<string, string> = {};
	if (config.stt.apiKey) headers.authorization = `Bearer ${config.stt.apiKey}`;

	const res = await fetch(endpoint(), {
		method: "POST",
		headers,
		body: form,
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`STT ${res.status} ${res.statusText} ${detail}`.trim());
	}

	const data = (await res.json()) as { text?: string };
	return (data.text ?? "").trim();
}
