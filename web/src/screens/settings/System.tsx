import { Field, Secret, Slider, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

export function SystemSection({ form, set, values }: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="The Realm"
        blurb="The ground the companion stands on — where it lives, how it locks, and the rhythm of its replies."
      />
      <div className="flex flex-col gap-5">
        <Card title="Access">
          <Secret
            label="Web password"
            value={form.webAuthPassword}
            onChange={(v) => set("webAuthPassword", v)}
            configured={values.webAuthConfigured}
            help="Gates this whole interface. Leave blank to keep the current one; clearing it in .env opens the door to anyone on the network."
          />
        </Card>

        <Card title="Host">
          <Grid>
            <Field label="Time zone" value={form.timezone} onChange={(v) => set("timezone", v)} placeholder="Asia/Almaty" mono />
            <Field
              label="Port"
              value={String(form.port)}
              onChange={(v) => set("port", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
          </Grid>
          <Field label="Data directory" value={form.dataDir} onChange={(v) => set("dataDir", v)} placeholder="./data" mono />
          <ToggleRow
            title="Re-attune on save"
            desc="Restart automatically when settings that need it change (a supervisor brings the process back)."
          >
            <Toggle checked={form.autoRestartOnSave} onChange={(v) => set("autoRestartOnSave", v)} />
          </ToggleRow>
        </Card>

        <Card title="Rhythm — how replies are gathered">
          <Slider
            label="Idle wait"
            value={form.chatBatchIdleMs}
            min={0}
            max={8000}
            step={250}
            suffix="ms"
            onChange={(v) => set("chatBatchIdleMs", v)}
            help="How long to wait for you to keep typing before the companion answers."
          />
          <Grid>
            <Field
              label="Step grow (ms)"
              value={String(form.chatBatchStepMs)}
              onChange={(v) => set("chatBatchStepMs", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
            <Field
              label="Max wait (ms)"
              value={String(form.chatBatchMaxMs)}
              onChange={(v) => set("chatBatchMaxMs", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
          </Grid>
        </Card>
      </div>
    </div>
  );
}
