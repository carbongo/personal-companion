/**
 * The Discord implementation of `CallTransport` — the first one, and the only
 * part of the call path that knows what Discord is.
 *
 * Two directions, kept deliberately separate:
 *
 *   RECEIVE. Discord hands out **per-user** Opus streams, so the bot subscribes
 *   to the owner's user id and to nothing else. Every other participant's audio
 *   is never decoded, never buffered, never seen — bystander exclusion is a
 *   property of what we subscribe to, not a judgement made later by a model.
 *   That is the whole security argument of docs/decisions/discord-voice-calls.md,
 *   so `subscribeToOwner` is the single place a subscription is ever opened and
 *   it refuses any id that is not the configured owner.
 *
 *   SEND. One `AudioPlayer`, one queue, and an honest answer about what happened
 *   to each piece of speech: "played" when it finished, "cut" when barge-in took
 *   it away mid-sentence. The call session truncates the persisted reply on
 *   "cut", so the distinction has to be exact rather than approximately right.
 *
 * The Discord objects arrive through small structural interfaces rather than
 * concrete classes. That is not indirection for its own sake: it is what makes
 * the owner-only rule and the played/cut contract testable without a live
 * gateway connection, which is the same posture the Telegram channel ships in.
 */

import { Readable } from "node:stream";
import {
	createAudioPlayer,
	createAudioResource,
	type DiscordGatewayAdapterCreator,
	entersState,
	joinVoiceChannel,
	NoSubscriberBehavior,
	StreamType,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import prism from "prism-media";

import { CallAudioResampler } from "#/companion-core/call/resample.ts";
import type {
	AudioFormat,
	CallTransport,
	PcmFrame,
	PlaybackResult,
} from "#/companion-core/call/types.ts";

/** Discord voice is always 48 kHz stereo; the decoder is configured to match. */
const DISCORD_SAMPLE_RATE = 48_000;
const DISCORD_CHANNELS = 2;
const DISCORD_FRAME_SIZE = 960;

/** The slice of an `AudioReceiveStream` we consume: bytes and an end. */
export interface OpusPacketStream {
	on(event: "data", listener: (chunk: Buffer) => void): unknown;
	on(event: "end" | "close", listener: () => void): unknown;
	on(event: "error", listener: (err: Error) => void): unknown;
	destroy?(): void;
}

/** The slice of a `VoiceReceiver` we use — speaking events plus subscribe. */
export interface VoiceReceiverLike {
	speaking: {
		on(event: "start", listener: (userId: string) => void): unknown;
		off?(event: "start", listener: (userId: string) => void): unknown;
	};
	subscribe(userId: string, options?: unknown): OpusPacketStream;
}

/** The slice of an `AudioPlayer` we drive. */
export interface AudioPlayerLike {
	on(event: "idle" | "error", listener: (...args: unknown[]) => void): unknown;
	play(resource: unknown): void;
	stop(force?: boolean): boolean;
}

/** The slice of a `VoiceConnection` we hold. */
export interface VoiceConnectionLike {
	receiver: VoiceReceiverLike;
	subscribe(player: unknown): unknown;
	destroy(): void;
}

/** Anything that turns synthesized bytes into something the player accepts. */
export type ResourceFactory = (
	audio: Uint8Array,
	format: AudioFormat,
) => unknown;

export interface DiscordCallTransportOptions {
	connection: VoiceConnectionLike;
	player: AudioPlayerLike;
	/** The one user id whose audio may ever be subscribed to. */
	ownerUserId: string;
	/** Overridable so tests can drive playback without an encoder. */
	createResource?: ResourceFactory;
	/** Overridable so tests can feed PCM without an Opus decoder. */
	decodeOpus?: (packets: OpusPacketStream) => OpusPacketStream;
	log?: (message: string) => void;
}

/**
 * Map a wire format onto the player's input type. "opus" means Ogg-encapsulated
 * Opus (what the TTS backends emit), "pcm16" means 48 kHz stereo raw — anything
 * else goes through the arbitrary path, which transcodes.
 */
function inputTypeFor(format: AudioFormat): StreamType {
	if (format === "opus") return StreamType.OggOpus;
	if (format === "pcm16") return StreamType.Raw;
	return StreamType.Arbitrary;
}

function defaultResourceFactory(audio: Uint8Array, format: AudioFormat) {
	const stream = Readable.from([Buffer.from(audio)]);
	return createAudioResource(stream, { inputType: inputTypeFor(format) });
}

/** Decode per-user Opus packets into 48 kHz stereo interleaved PCM. */
function defaultOpusDecoder(packets: OpusPacketStream): OpusPacketStream {
	const decoder = new prism.opus.Decoder({
		frameSize: DISCORD_FRAME_SIZE,
		channels: DISCORD_CHANNELS,
		rate: DISCORD_SAMPLE_RATE,
	});
	(packets as unknown as NodeJS.ReadableStream).pipe(decoder);
	return decoder as unknown as OpusPacketStream;
}

/** One queued piece of speech, and the promise the caller is waiting on. */
interface Queued {
	audio: Uint8Array;
	format: AudioFormat;
	settle: (result: PlaybackResult) => void;
}

export class DiscordCallTransport implements CallTransport {
	private readonly connection: VoiceConnectionLike;
	private readonly player: AudioPlayerLike;
	private readonly ownerUserId: string;
	private readonly createResource: ResourceFactory;
	private readonly decodeOpus: (p: OpusPacketStream) => OpusPacketStream;
	private readonly log: (message: string) => void;

	private readonly listeners = new Set<(frame: PcmFrame) => void>();
	private readonly resampler = new CallAudioResampler(
		DISCORD_CHANNELS,
		DISCORD_SAMPLE_RATE,
	);
	/** A half sample carried between chunks, so a split Int16 never misaligns. */
	private carry: Buffer | null = null;

	private queue: Queued[] = [];
	private current: Queued | null = null;
	private subscription: OpusPacketStream | null = null;
	private closed = false;

	constructor(opts: DiscordCallTransportOptions) {
		this.connection = opts.connection;
		this.player = opts.player;
		this.ownerUserId = opts.ownerUserId;
		this.createResource = opts.createResource ?? defaultResourceFactory;
		this.decodeOpus = opts.decodeOpus ?? defaultOpusDecoder;
		this.log = opts.log ?? ((m) => console.log(m));

		this.connection.subscribe(this.player);
		this.player.on("idle", () => this.onPlayerIdle());
		this.player.on("error", (...args: unknown[]) => {
			const err = args[0];
			this.log(
				`[discord] playback error: ${err instanceof Error ? err.message : String(err)}`,
			);
			this.onPlayerIdle();
		});

		// The only subscription trigger. Discord announces every speaker here;
		// anyone who is not the owner is dropped on the spot, so their audio is
		// never requested from the gateway in the first place.
		this.connection.receiver.speaking.on("start", (userId: string) => {
			if (userId !== this.ownerUserId) return;
			this.subscribeToOwner();
		});
	}

	// ---------------------------------------------------------------- receive

	/**
	 * Open the owner's stream, unless one is already open. The id check is
	 * repeated here on purpose: this function is the only door to
	 * `receiver.subscribe`, and it must stay impossible to walk through it with
	 * somebody else's id.
	 */
	private subscribeToOwner(): void {
		if (this.closed || this.subscription || !this.ownerUserId) return;

		const stream = this.connection.receiver.subscribe(this.ownerUserId);
		this.subscription = stream;
		const decoded = this.decodeOpus(stream);

		decoded.on("data", (chunk: Buffer) => this.onPcmChunk(chunk));
		const end = () => {
			if (this.subscription === stream) {
				this.subscription = null;
				this.carry = null;
				// The filter history belongs to a contiguous stretch of speech; a
				// new subscription is a new stretch.
				this.resampler.reset();
			}
		};
		decoded.on("end", end);
		decoded.on("close", end);
		decoded.on("error", (err: Error) => {
			this.log(`[discord] owner audio stream error: ${err.message}`);
			end();
		});
	}

	/** Decoded 48 kHz stereo bytes in; 16 kHz mono frames out to the engine. */
	private onPcmChunk(chunk: Buffer): void {
		if (!this.listeners.size) return;
		let bytes = chunk;
		if (this.carry) {
			bytes = Buffer.concat([this.carry, chunk]);
			this.carry = null;
		}
		if (bytes.length % 2 === 1) {
			this.carry = bytes.subarray(bytes.length - 1);
			bytes = bytes.subarray(0, bytes.length - 1);
		}
		if (!bytes.length) return;

		const interleaved = new Int16Array(bytes.length / 2);
		for (let i = 0; i < interleaved.length; i++)
			interleaved[i] = bytes.readInt16LE(i * 2);

		const frame = this.resampler.process(interleaved);
		if (!frame.samples.length) return;
		for (const listener of this.listeners) listener(frame);
	}

	onOwnerAudio(listener: (frame: PcmFrame) => void): () => void {
		this.listeners.add(listener);
		// A listener arriving mid-call still wants audio; if the owner is already
		// speaking the speaking event has been and gone.
		this.subscribeToOwner();
		return () => {
			this.listeners.delete(listener);
		};
	}

	// ------------------------------------------------------------------- send

	play(audio: Uint8Array, format: AudioFormat): Promise<PlaybackResult> {
		if (this.closed) return Promise.resolve<PlaybackResult>("cut");
		return new Promise<PlaybackResult>((resolve) => {
			this.queue.push({ audio, format, settle: resolve });
			this.pump();
		});
	}

	/** Start the next queued item when nothing is in flight. */
	private pump(): void {
		if (this.current || this.closed) return;
		const next = this.queue.shift();
		if (!next) return;
		this.current = next;
		try {
			this.player.play(this.createResource(next.audio, next.format));
		} catch (err) {
			this.log(`[discord] could not start playback: ${(err as Error).message}`);
			// A resource we could not even build never reached the owner's ears,
			// which is what "cut" means to the session.
			this.current = null;
			next.settle("cut");
			this.pump();
		}
	}

	/** The player went idle: whatever was playing reached its end. */
	private onPlayerIdle(): void {
		const finished = this.current;
		this.current = null;
		finished?.settle("played");
		this.pump();
	}

	stopPlayback(): void {
		const cut = this.current;
		const pending = this.queue;
		this.current = null;
		this.queue = [];
		// Clear state before stopping, so the "idle" the stop provokes finds
		// nothing in flight and cannot resolve a cut item as "played".
		this.player.stop(true);
		cut?.settle("cut");
		for (const item of pending) item.settle("cut");
	}

	// ------------------------------------------------------------------ close

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.stopPlayback();
		this.listeners.clear();
		this.subscription?.destroy?.();
		this.subscription = null;
		try {
			this.connection.destroy();
		} catch {
			// Already destroyed (the owner left first) — leaving is idempotent.
		}
	}
}

/** How long to wait for the voice websocket + UDP handshake before giving up. */
const CONNECT_TIMEOUT_MS = 20_000;

export interface JoinCallOptions {
	guildId: string;
	channelId: string;
	ownerUserId: string;
	adapterCreator: DiscordGatewayAdapterCreator;
	log?: (message: string) => void;
}

/**
 * Join a voice channel and wrap the connection in a transport.
 *
 * `selfDeaf: false` is required — a deafened bot receives nothing, and receiving
 * is half the point. Note that this is the *only* place deafening is turned off,
 * and it is paired with the owner-only subscription above: the bot can hear the
 * channel in principle and asks for exactly one person's audio in practice.
 */
export async function createDiscordCallTransport(
	opts: JoinCallOptions,
): Promise<DiscordCallTransport> {
	const connection = joinVoiceChannel({
		channelId: opts.channelId,
		guildId: opts.guildId,
		adapterCreator: opts.adapterCreator,
		selfDeaf: false,
		selfMute: false,
	});

	try {
		await entersState(
			connection,
			VoiceConnectionStatus.Ready,
			CONNECT_TIMEOUT_MS,
		);
	} catch (err) {
		connection.destroy();
		throw err;
	}

	// Keep playing when nobody is listening rather than pausing mid-sentence:
	// a paused player would resume into a conversation that has moved on.
	const player = createAudioPlayer({
		behaviors: { noSubscriber: NoSubscriberBehavior.Play },
	});

	return new DiscordCallTransport({
		connection: connection as unknown as VoiceConnectionLike,
		player: player as unknown as AudioPlayerLike,
		ownerUserId: opts.ownerUserId,
		log: opts.log,
	});
}
