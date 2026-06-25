import { Field, Secret, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, SectionIntro, ToggleRow } from "./ui.tsx";

export function ChannelsSection({ form, set, values }: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="Channels"
        blurb="Where the companion reaches you. The web converse here is always on; Telegram lets the same companion answer from your pocket."
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
            placeholder="570440507, 123456789"
            mono
            help="Only these numeric Telegram IDs may talk to the companion."
          />
          <ToggleRow title="Split long replies" desc="Break messages over Telegram's 4096-character limit into parts.">
            <Toggle checked={form.telegramReplySplit} onChange={(v) => set("telegramReplySplit", v)} />
          </ToggleRow>
        </Card>
      </div>
    </div>
  );
}
