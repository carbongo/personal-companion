import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";

import type { CallTransport } from "#/companion-core/call/types.ts";
import { config } from "#/config/index.ts";
import { discordConfigured, startDiscord } from "./index.ts";

// Obviously fake snowflakes and a placeholder token — never real credentials.
const GUILD_ID = "200000000000000001";
const CHANNEL_ID = "200000000000000002";
const OWNER_ID = "200000000000000003";
const BYSTANDER_ID = "200000000000000004";
const TOKEN = "not-a-real-token";

/**
 * A stand-in Discord client: records handlers, never touches the network.
 *
 * `guildFetches` decides whether looking the guild up succeeds. It fails by
 * default, because without a gateway that is what really happens and the
 * caught-not-thrown path is the one most tests are about. Pass `true` to get
 * past it and watch what the channel does with a guild it actually has.
 */
function fakeClient(
	login: () => Promise<string> = () => Promise.resolve("ok"),
	guildFetches = false,
) {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const state = {
		logins: [] as string[],
		fetchedGuilds: [] as string[],
	};
	const client = {
		on(event: string, listener: (...args: unknown[]) => void) {
			handlers.set(event, listener);
			return client;
		},
		once(event: string, listener: (...args: unknown[]) => void) {
			handlers.set(event, listener);
			return client;
		},
		login(token: string) {
			state.logins.push(token);
			return login();
		},
		guilds: {
			fetch(id: string) {
				state.fetchedGuilds.push(id);
				// No gateway here, so joining can only fail — which is exactly the
				// path that must be caught rather than thrown.
				return guildFetches
					? Promise.resolve({ voiceAdapterCreator: () => ({}) })
					: Promise.reject(new Error("no gateway in tests"));
			},
		},
	};
	return {
		state,
		emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
		has: (event: string) => handlers.has(event),
		client: client as unknown as Client,
	};
}

/** Run with a given Discord/call config, restoring whatever was there before. */
function withConfig(
	patch: {
		botToken?: string;
		guildId?: string;
		voiceChannelId?: string;
		ownerUserId?: string;
		enabled?: boolean;
	},
	run: () => void | Promise<void>,
): void | Promise<void> {
	const prevDiscord = { ...config.discord };
	const prevEnabled = config.call.enabled;
	const quietLog = console.log;
	const quietWarn = console.warn;
	console.log = () => {};
	console.warn = () => {};

	config.discord.botToken = patch.botToken ?? "";
	config.discord.guildId = patch.guildId ?? "";
	config.discord.voiceChannelId = patch.voiceChannelId ?? "";
	config.discord.ownerUserId = patch.ownerUserId ?? "";
	config.call.enabled = patch.enabled ?? false;

	const restore = () => {
		Object.assign(config.discord, prevDiscord);
		config.call.enabled = prevEnabled;
		console.log = quietLog;
		console.warn = quietWarn;
	};

	try {
		const result = run();
		if (result instanceof Promise) return result.finally(restore);
		restore();
	} catch (err) {
		restore();
		throw err;
	}
}

const complete = {
	botToken: TOKEN,
	guildId: GUILD_ID,
	voiceChannelId: CHANNEL_ID,
	ownerUserId: OWNER_ID,
	enabled: true,
};

describe("discordConfigured", () => {
	it("is false without a bot token", () => {
		withConfig({ ...complete, botToken: "" }, () => {
			expect(discordConfigured()).toBe(false);
		});
	});

	it("is false without a guild", () => {
		withConfig({ ...complete, guildId: "" }, () => {
			expect(discordConfigured()).toBe(false);
		});
	});

	it("is false without a voice channel", () => {
		withConfig({ ...complete, voiceChannelId: "" }, () => {
			expect(discordConfigured()).toBe(false);
		});
	});

	it("is true once token, guild and channel are all set", () => {
		withConfig(complete, () => {
			expect(discordConfigured()).toBe(true);
		});
	});
});

describe("startDiscord", () => {
	it("does nothing, and throws nothing, when unconfigured", () => {
		withConfig({}, () => {
			const fake = fakeClient();
			expect(() => startDiscord({ client: fake.client })).not.toThrow();
			expect(fake.state.logins).toEqual([]);
		});
	});

	it("does not connect while calling is switched off", () => {
		withConfig({ ...complete, enabled: false }, () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });
			expect(fake.state.logins).toEqual([]);
		});
	});

	it("refuses to start without an owner id", () => {
		withConfig({ ...complete, ownerUserId: "" }, () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });
			expect(fake.state.logins).toEqual([]);
		});
	});

	it("connects and listens once fully configured", () => {
		withConfig(complete, () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });

			expect(fake.state.logins).toEqual([TOKEN]);
			expect(fake.has("voiceStateUpdate")).toBe(true);
			expect(fake.has("interactionCreate")).toBe(true);
		});
	});

	it("swallows a failed connection instead of taking the process down", async () => {
		await withConfig(complete, async () => {
			const fake = fakeClient(() =>
				Promise.reject(new Error("invalid credentials")),
			);
			expect(() => startDiscord({ client: fake.client })).not.toThrow();
			// Give the rejected login a turn to land uncaught, if it were going to.
			await Bun.sleep(1);
		});
	});

	it("opens a call when the owner joins, and ignores anyone else", async () => {
		await withConfig(complete, async () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });

			fake.emit(
				"voiceStateUpdate",
				{ id: BYSTANDER_ID, channelId: null },
				{ id: BYSTANDER_ID, channelId: CHANNEL_ID },
			);
			await Bun.sleep(1);
			expect(fake.state.fetchedGuilds).toEqual([]);

			fake.emit(
				"voiceStateUpdate",
				{ id: OWNER_ID, channelId: null },
				{ id: OWNER_ID, channelId: CHANNEL_ID },
			);
			await Bun.sleep(1);
			expect(fake.state.fetchedGuilds).toEqual([GUILD_ID]);
		});
	});

	it("hands the transport to the call engine, and stops it on leaving", async () => {
		await withConfig(complete, async () => {
			const fake = fakeClient(undefined, true);
			const started: unknown[] = [];
			let stopped = 0;
			const transport = {
				onOwnerAudio: () => () => {},
				play: async () => "played" as const,
				stopPlayback: () => {},
				close: async () => {},
			} satisfies CallTransport;
			startDiscord({
				client: fake.client,
				createTransport: async () => transport,
				startSession: async (given) => {
					started.push(given);
					return {
						stop: async () => {
							stopped += 1;
						},
					};
				},
			});

			fake.emit(
				"voiceStateUpdate",
				{ id: OWNER_ID, channelId: null },
				{ id: OWNER_ID, channelId: CHANNEL_ID },
			);
			await Bun.sleep(1);
			// Opening a call swallows its own failures, so asserting on the Discord
			// side alone would pass even if nothing reached the engine.
			expect(started).toEqual([transport]);

			fake.emit(
				"voiceStateUpdate",
				{ id: OWNER_ID, channelId: CHANNEL_ID },
				{ id: OWNER_ID, channelId: null },
			);
			await Bun.sleep(1);
			expect(stopped).toBe(1);
		});
	});

	it("ignores the owner joining some other channel", async () => {
		await withConfig(complete, async () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });

			fake.emit(
				"voiceStateUpdate",
				{ id: OWNER_ID, channelId: null },
				{ id: OWNER_ID, channelId: "200000000000000009" },
			);
			await Bun.sleep(1);
			expect(fake.state.fetchedGuilds).toEqual([]);
		});
	});

	it("only lets the owner use /call", async () => {
		await withConfig(complete, async () => {
			const fake = fakeClient();
			startDiscord({ client: fake.client });

			const interaction = (userId: string) => ({
				isChatInputCommand: () => true,
				commandName: "call",
				user: { id: userId },
				reply: () => Promise.resolve(),
			});

			fake.emit("interactionCreate", interaction(BYSTANDER_ID));
			await Bun.sleep(1);
			expect(fake.state.fetchedGuilds).toEqual([]);

			fake.emit("interactionCreate", interaction(OWNER_ID));
			await Bun.sleep(1);
			expect(fake.state.fetchedGuilds).toEqual([GUILD_ID]);
		});
	});
});
