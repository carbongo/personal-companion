import { Field, Secret, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

export function ChannelsSection({ form, set, values }: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="Channels"
        blurb="Where the companion reaches you. The web converse here is always on; Telegram lets the same companion answer from your pocket, and Discord lets you talk to it out loud."
      />
      <div className="flex flex-col gap-5">
        <Card title="Telegram">
          <Secret
            label="Bot token"
            value={form.telegramToken}
            onChange={(v) => set("telegramToken", v)}
            configured={values.telegramConfigured}
            help="From @BotFather. Saving a new token takes effect after a restart."
          />
          <Field
            label="Allowed user IDs"
            value={form.telegramAllowedIds}
            onChange={(v) => set("telegramAllowedIds", v)}
            placeholder="123456789, 987654321"
            mono
            help="Only these numeric Telegram IDs may talk to the companion."
          />
          <ToggleRow title="Split long replies" desc="Break messages over Telegram's 4096-character limit into parts.">
            <Toggle checked={form.telegramReplySplit} onChange={(v) => set("telegramReplySplit", v)} />
          </ToggleRow>
        </Card>

        <Card title="Discord">
          <p className="text-[13px] text-ink-faint">
            Discord carries <span className="text-ink-dim">voice only</span> — joining a live call in one
            channel. Text chat stays on Telegram and the web converse here; there is no Discord text bridge.
            The bot only ever listens to the owner user ID below, so a shared server stays safe to invite it
            into.
          </p>
          <Secret
            label="Bot token"
            value={form.discordBotToken}
            onChange={(v) => set("discordBotToken", v)}
            configured={values.discordConfigured}
            help="From the Discord developer portal. Saving a new token takes effect after a restart."
          />
          <Grid>
            <Field
              label="Guild ID"
              value={form.discordGuildId}
              onChange={(v) => set("discordGuildId", v)}
              placeholder="the server the bot joins"
              mono
            />
            <Field
              label="Voice channel ID"
              value={form.discordVoiceChannelId}
              onChange={(v) => set("discordVoiceChannelId", v)}
              placeholder="the channel it calls into"
              mono
            />
          </Grid>
          <Field
            label="Owner user ID"
            value={form.discordOwnerUserId}
            onChange={(v) => set("discordOwnerUserId", v)}
            placeholder="the only Discord user it will answer"
            mono
            help="Everyone else in the voice channel is ignored."
          />
        </Card>
      </div>
    </div>
  );
}
