/**
 * Claude CLI provider — a Claude model reached by spawning the locally installed
 * `claude` binary in headless mode (`claude -p`), rather than over HTTP. There is
 * no API key: the CLI carries its own authentication, so a box that can already
 * run Claude Code can host the companion's brain with nothing else configured.
 * That makes it the practical choice for an always-on server (see
 * docs/decisions/claude-cli-provider.md).
 *
 * The CLI is a *session* tool and we need a stateless one generation per turn, so
 * every call spawns a fresh process:
 *
 *   - system messages become `--system-prompt`, which replaces Claude Code's own
 *     prompt entirely — no CLAUDE.md, no coding scaffolding, just the persona;
 *   - `--tools ""`, `--strict-mcp-config` and `--setting-sources ""` strip the
 *     agent down to a plain chat model, so it can't touch the host machine and
 *     doesn't inherit whatever settings the box happens to have;
 *   - prior turns are flattened into one labelled transcript. Sending them as
 *     separate stream-json messages is not an option: the CLI answers *each* user
 *     message it reads, which would bill and generate a reply per historical line.
 *
 * `LLM_THINK` maps to `--effort`. `LLM_TEMPERATURE` and `LLM_MAX_TOKENS` have no
 * CLI equivalent and are ignored — reply length is the persona's job here.
 */
import type { LlmConfig } from "#/config/index.ts";
import {
	type ChatMessage,
	type GenerateOptions,
	type LLMProvider,
	type ProviderInfo,
	ProviderUnreachableError,
	type StreamDelta,
} from "./types.ts";

/** Effort levels the CLI accepts; anything else is left to its own default. */
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Spawn with all three streams piped — one place, so the types stay precise. */
const spawnCli = (args: string[]) =>
	Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });

interface ImageBlock {
	type: "image";
	source: { type: "base64"; media_type: string; data: string };
}
interface TextBlock {
	type: "text";
	text: string;
}

/**
 * Sniff an image's type from the first bytes of its base64. The Anthropic message
 * format wants a truthful `media_type`, and the engine hands us bare base64 with
 * no hint of what it is. Defaults to JPEG, the common case for photos.
 */
export function mediaTypeOf(b64: string): string {
	if (b64.startsWith("iVBORw0KGgo")) return "image/png";
	if (b64.startsWith("R0lGOD")) return "image/gif";
	if (b64.startsWith("UklGR")) return "image/webp";
	return "image/jpeg";
}

/**
 * Fold a turn into what the CLI can take: one system prompt and one user message.
 * Prior turns are labelled plainly ("User:" / "Assistant:") — the persona in the
 * system prompt supplies the real names.
 */
export function buildPrompt(messages: ChatMessage[]): {
	system: string;
	text: string;
	images: string[];
} {
	const system = messages
		.filter((m) => m.role === "system")
		.map((m) => m.content.trim())
		.filter(Boolean)
		.join("\n\n");

	const turns = messages.filter((m) => m.role !== "system");
	const last = turns.at(-1);
	const history = (last?.role === "user" ? turns.slice(0, -1) : turns).filter(
		(m) => m.content.trim(),
	);

	const parts: string[] = [];
	if (history.length) {
		const transcript = history
			.map(
				(m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`,
			)
			.join("\n");
		parts.push(
			`Here is the conversation so far, for context:\n\n${transcript}\n\nReply to the new message below — only your reply, with no label or prefix.`,
		);
	}
	// A trailing assistant message is a prefill hint the CLI can't take; the
	// transcript above already carries it, so only a real user turn adds text.
	if (last?.role === "user" && last.content.trim())
		parts.push(last.content.trim());

	return {
		system,
		text: parts.join("\n\n"),
		// Only the latest turn's images matter; older ones are long gone from the
		// transcript, which is text.
		images: last?.images ?? [],
	};
}

export class ClaudeCliProvider implements LLMProvider {
	readonly name = "claude-cli";

	constructor(private readonly cfg: LlmConfig) {}

	describe(): ProviderInfo {
		return {
			provider: "claude-cli",
			model: this.model(),
			endpoint: this.cfg.claudeBin,
		};
	}

	/** The CLI is here and runnable. Says nothing about auth — a real generation does. */
	async reachable(): Promise<boolean> {
		try {
			const proc = Bun.spawn([this.cfg.claudeBin, "--version"], {
				stdout: "ignore",
				stderr: "ignore",
				stdin: "ignore",
			});
			const timer = setTimeout(() => proc.kill(), 8000);
			const code = await proc.exited;
			clearTimeout(timer);
			return code === 0;
		} catch {
			return false;
		}
	}

	private model(override?: string): string {
		const name = override?.trim() || this.cfg.model.trim();
		// Ollama-style tags ("gemma4:12b") mean the model was never switched over
		// with the provider; the CLI would fail with something far less obvious.
		if (name.includes(":"))
			throw new Error(
				`LLM_MODEL="${name}" is not a Claude model — set an alias ("haiku", "sonnet", "opus") or a full name ("claude-haiku-4-5") for the claude-cli provider.`,
			);
		return name || "haiku";
	}

	private effort(override?: boolean | string): string | null {
		const raw = (override ?? this.cfg.think).toString().toLowerCase();
		if (EFFORT_LEVELS.has(raw)) return raw;
		// The CLI has no off switch, so booleans pick the nearest sane level.
		if (raw === "false" || raw === "minimal") return "low";
		if (raw === "true") return "medium";
		return null;
	}

	private args(opts: GenerateOptions | undefined, stream: boolean): string[] {
		const effort = this.effort(opts?.think);
		return [
			this.cfg.claudeBin,
			"--print",
			"--verbose", // required alongside stream-json output
			"--model",
			this.model(opts?.model),
			...(effort ? ["--effort", effort] : []),
			"--tools",
			"", // a plain chat model: no Bash, no Read, no reach into the host
			"--strict-mcp-config", // ...and no MCP servers from the host's config
			"--setting-sources",
			"", // ...and no user/project settings, hooks or CLAUDE.md
			"--no-session-persistence", // one turn, nothing left on disk
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			...(stream ? ["--include-partial-messages"] : []),
		];
	}

	/** The single user message the CLI reads on stdin, images first. */
	private stdinLine(text: string, images: string[]): string {
		const content: Array<ImageBlock | TextBlock> = images.map((data) => ({
			type: "image",
			source: { type: "base64", media_type: mediaTypeOf(data), data },
		}));
		if (text) content.push({ type: "text", text });
		return `${JSON.stringify({
			type: "user",
			message: { role: "user", content },
		})}\n`;
	}

	/**
	 * Run one generation. Reads the CLI's NDJSON stream, handing text deltas to
	 * `onDelta` when asked for, and resolves with the full reply.
	 */
	private async run(
		messages: ChatMessage[],
		opts: GenerateOptions | undefined,
		onDelta?: StreamDelta,
	): Promise<string> {
		const { system, text, images } = buildPrompt(messages);
		const args = this.args(opts, Boolean(onDelta));
		if (system) args.push("--system-prompt", system);

		let proc: ReturnType<typeof spawnCli>;
		try {
			proc = spawnCli(args);
		} catch (err) {
			// Binary missing or not executable — the box can't run the CLI at all.
			throw new ProviderUnreachableError(
				`claude CLI not runnable (${this.cfg.claudeBin}): ${(err as Error).message}`,
			);
		}

		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, this.cfg.timeoutMs);

		try {
			proc.stdin.write(this.stdinLine(text, images));
			await proc.stdin.end();

			// One mutable bag: the stream handler below is a closure, and fields keep
			// their declared types across it where plain locals would not.
			const seen = {
				result: null as string | null,
				failure: null as string | null,
				streamed: "",
				blocks: "",
			};

			const handle = async (line: string): Promise<void> => {
				const trimmed = line.trim();
				if (!trimmed) return;
				let obj: Record<string, unknown>;
				try {
					obj = JSON.parse(trimmed) as Record<string, unknown>;
				} catch {
					return; // stray non-JSON line; the result line is what matters
				}
				switch (obj.type) {
					case "stream_event": {
						const event = obj.event as
							| { type?: string; delta?: { type?: string; text?: string } }
							| undefined;
						if (
							event?.type === "content_block_delta" &&
							event.delta?.type === "text_delta"
						) {
							const piece = event.delta.text ?? "";
							if (piece && onDelta) {
								seen.streamed += piece;
								await onDelta(piece);
							}
						}
						return;
					}
					case "assistant": {
						// The whole message, thinking blocks included — text only.
						const message = obj.message as
							| { content?: Array<{ type?: string; text?: string }> }
							| undefined;
						for (const block of message?.content ?? [])
							if (block.type === "text" && block.text)
								seen.blocks += block.text;
						return;
					}
					case "result": {
						if (obj.is_error || obj.subtype !== "success")
							seen.failure = String(
								obj.result ?? obj.subtype ?? "unknown error",
							);
						else seen.result = String(obj.result ?? "");
						return;
					}
				}
			};

			let buf = "";
			const decoder = new TextDecoder();
			for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
				buf += decoder.decode(chunk, { stream: true });
				let nl: number;
				// biome-ignore lint/suspicious/noAssignInExpressions: line scan
				while ((nl = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					await handle(line);
				}
			}
			if (buf) await handle(buf);

			const code = await proc.exited;
			if (timedOut)
				throw new ProviderUnreachableError(
					`claude CLI timed out after ${this.cfg.timeoutMs}ms`,
				);
			if (seen.failure) throw new Error(`claude-cli: ${seen.failure}`);
			if (seen.result !== null) return seen.result.trim();

			// No result line: the CLI failed before answering. Anything it did say
			// beats an error; otherwise its stderr is what we pass on.
			const salvaged = seen.streamed.trim() || seen.blocks.trim();
			if (salvaged) return salvaged;
			const stderr = (await new Response(proc.stderr).text()).trim();
			throw new Error(
				`claude-cli exited ${code} without a reply${stderr ? `: ${stderr.slice(0, 300)}` : ""}`,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	async chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<string> {
		return this.run(messages, opts);
	}

	async chatStream(
		messages: ChatMessage[],
		onDelta: StreamDelta,
		opts?: GenerateOptions,
	): Promise<string> {
		return this.run(messages, opts, onDelta);
	}

	/** Every current Claude model can see. */
	async supportsVision(): Promise<boolean> {
		return true;
	}
}
