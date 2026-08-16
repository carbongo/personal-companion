/**
 * The call engine's contract with the outside world.
 *
 * A live call is a loop — the owner speaks, the companion answers, the owner
 * interrupts — and every stage of it is easier to reason about when there is
 * exactly one audio currency and exactly one transport shape. This file defines
 * both, and nothing here knows about Discord, SIP, or the web client: those are
 * transports, and they implement `CallTransport` from the outside.
 *
 * See docs/decisions/discord-voice-calls.md.
 */

/** Mono 16-bit PCM at a known sample rate: the call engine's internal audio currency. */
export interface PcmFrame {
	samples: Int16Array;
	sampleRate: number;
}

/**
 * A wire format for synthesized speech handed to a transport. The transport
 * decides what it can play natively and what it has to transcode.
 */
export type AudioFormat = "opus" | "wav" | "pcm16";

/** What a transport reports back about one queued piece of speech. */
export type PlaybackResult = "played" | "cut";

/**
 * A call transport — Discord today, SIP or the web client later. The engine knows
 * nothing else about how audio reaches the owner.
 */
export interface CallTransport {
	/** Owner mic audio ONLY. ~20ms mono frames, already resampled to 16 kHz. Returns an unsubscribe. */
	onOwnerAudio(listener: (frame: PcmFrame) => void): () => void;
	/** Queue synthesized speech. Resolves "played" when it finished, "cut" if barge-in stopped it. */
	play(audio: Uint8Array, format: AudioFormat): Promise<PlaybackResult>;
	/** Stop playback now and drop what is queued; in-flight play() calls resolve "cut". */
	stopPlayback(): void;
	/** Leave the call and release resources. */
	close(): Promise<void>;
}

/** A speech/non-speech detector over fixed-size frames. */
export interface VoiceActivityDetector {
	readonly name: string;
	/** Probability 0..1 that the frame contains speech. Frames are 512 samples @ 16 kHz. */
	process(frame: PcmFrame): Promise<number> | number;
	reset(): void;
}
