/**
 * Discord channel — **voice only**. Text stays on Telegram and the web chat;
 * what Discord adds is a live call, so this file does one thing: notice that the
 * owner wants to talk, join their voice channel, and hand the resulting
 * transport to the call engine.
 *
 * There are two ways in, and they are the two ways people actually start a call:
 * walking into the channel (`voiceStateUpdate`) and asking for the companion
 * explicitly (`/call`). Both are gated on the configured owner id — nobody else
 * can summon the bot, and once it is in the channel it subscribes to the owner's
 * audio alone (see transport.ts).
 *
 * Opus and voice encryption run on the pure-JS path (`opusscript`,
 * `@noble/ciphers`), which is what makes this work under Bun without native
 * modules. Nothing here should ever reach for `sodium-native`.
 *
 * See docs/decisions/discord-voice-calls.md and docs/channels.md.
 */
import {
	Client,
	Events,
	GatewayIntentBits,
	type Interaction,
	MessageFlags,
	type VoiceState,
} from "discord.js";

import { createDiscordCallTransport } from "#/channels/discord/transport.ts";
import type { CallTransport } from "#/companion-core/call/types.ts";
import { config, discordConfigured } from "#/config/index.ts";

export { discordConfigured };

/** The one slash command this channel registers, on the configured guild only. */
const CALL_COMMAND = {
	name: "call",
	description: "Start a live voice call with your companion",
};

const log = (message: string) => console.log(`[discord] ${message}`);
const warn = (message: string) => console.warn(`[discord] ${message}`);

/** What an open call gives back: something to stop when it ends. */
interface OpenCall {
	stop(): Promise<void>;
}

export interface StartDiscordOptions {
	/** Injectable so tests can drive the channel without a gateway connection. */
	client?: Client;
	/**
	 * Injectable so tests can assert the transport actually reaches the call
	 * engine. Opening a call is deliberately forgiving — every failure inside
	 * `openCall` is logged rather than thrown — which means a test that only
	 * watches the Discord side cannot tell a call that opened from one that
	 * fell over on the way. Defaults to the lazily imported real engine.
	 */
	startSession?: (transport: CallTransport) => Promise<OpenCall>;
	/** Injectable for the same reason: joining a real voice channel needs a gateway. */
	createTransport?: (
		opts: Parameters<typeof createDiscordCallTransport>[0],
	) => Promise<CallTransport>;
}

/**
 * Start the Discord channel. No-op when Discord or calling is not configured,
 * and a failure to connect is logged rather than thrown — the companion keeps
 * answering everywhere else if its Discord credentials are wrong.
 */
export function startDiscord(options: StartDiscordOptions = {}): void {
	if (!discordConfigured()) return;
	if (!config.call.enabled) {
		log("configured, but calling is off (CALL_ENABLED=false) — not connecting");
		return;
	}
	if (!config.discord.ownerUserId) {
		warn(
			"DISCORD_OWNER_USER_ID is empty — no call can start, because the bot would not know whose voice it may listen to.",
		);
		return;
	}

	const { guildId, voiceChannelId, ownerUserId } = config.discord;
	const client =
		options.client ??
		new Client({
			// Guilds for the guild/channel cache, GuildVoiceStates so joins and
			// leaves arrive. No message intents: this channel never reads text.
			intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
		});

	let call: OpenCall | null = null;
	let opening = false;

	async function openCall(channelId: string): Promise<void> {
		if (call || opening) return;
		opening = true;
		try {
			const guild = await client.guilds.fetch(guildId);
			// The call engine (and the VAD model behind it) is loaded when a call
			// actually starts, so an idle deployment pays nothing for a feature it
			// may never use. Loaded before joining, so a failure here leaves no
			// half-open voice connection behind.
			const startSession =
				options.startSession ??
				(async (transport: CallTransport) => {
					const { startCallSession } = await import(
						"#/companion-core/call/index.ts"
					);
					return startCallSession(transport);
				});
			const createTransport =
				options.createTransport ?? createDiscordCallTransport;
			const transport = await createTransport({
				guildId,
				channelId,
				ownerUserId,
				adapterCreator: guild.voiceAdapterCreator,
				log,
			});
			call = await startSession(transport);
			log("call open");
		} catch (err) {
			warn(`could not open the call: ${(err as Error).message}`);
			call = null;
		} finally {
			opening = false;
		}
	}

	async function closeCall(reason: string): Promise<void> {
		const open = call;
		call = null;
		if (!open) return;
		try {
			await open.stop();
		} catch (err) {
			warn(`closing the call failed: ${(err as Error).message}`);
		}
		log(`call closed (${reason})`);
	}

	client.once(Events.ClientReady, (ready) => {
		log(`${ready.user.tag} online — waiting for a call`);
		// Guild-scoped, so it appears immediately and only where it is wanted.
		ready.application.commands
			.create(CALL_COMMAND, guildId)
			.catch((err: Error) => warn(`could not register /call: ${err.message}`));
	});

	client.on(
		Events.VoiceStateUpdate,
		(before: VoiceState, after: VoiceState) => {
			const userId = after.id || before.id;
			if (userId !== ownerUserId) return;

			const joined =
				after.channelId === voiceChannelId &&
				before.channelId !== voiceChannelId;
			const left =
				before.channelId === voiceChannelId &&
				after.channelId !== voiceChannelId;

			if (joined) void openCall(voiceChannelId);
			else if (left) void closeCall("owner left the channel");
		},
	);

	client.on(Events.InteractionCreate, (interaction: Interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== CALL_COMMAND.name) return;
		// The same gate as everywhere else: only the owner summons the companion.
		if (interaction.user.id !== ownerUserId) {
			void interaction
				.reply({
					content: "This companion belongs to someone else.",
					flags: MessageFlags.Ephemeral,
				})
				.catch(() => {});
			return;
		}
		void interaction
			.reply({ content: "Coming.", flags: MessageFlags.Ephemeral })
			.catch(() => {});
		void openCall(voiceChannelId);
	});

	client.on(Events.Error, (err: Error) => warn(`client error: ${err.message}`));

	client.login(config.discord.botToken).catch((err: Error) => {
		warn(`failed to connect: ${err.message}`);
	});
}
