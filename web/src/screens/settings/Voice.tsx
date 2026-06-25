import { Field, Secret, Select } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro } from "./ui.tsx";

const STT = [
  { value: "off", label: "Off — no transcription" },
  { value: "openai", label: "OpenAI-compatible (Whisper API)" },
  { value: "whisper-http", label: "Local Whisper (speaches / faster-whisper)" },
];

export function VoiceSection({ form, set, values }: SectionProps) {
  const off = form.sttProvider === "off";
  return (
    <div>
      <SectionIntro
        title="Voice"
        blurb="Let voice notes become words. Used by both the web converse (the mic) and Telegram voice messages."
      />
      <div className="flex flex-col gap-5">
        <Card title="Speech-to-text">
          <Select label="Engine" value={form.sttProvider} onChange={(v) => set("sttProvider", v)} options={STT} />
          {!off && (
            <>
              <Grid>
                <Field
                  label="API URL"
                  value={form.sttApiUrl}
                  onChange={(v) => set("sttApiUrl", v)}
                  placeholder="http://localhost:9000"
                  mono
                />
                <Secret
                  label="API key"
                  value={form.sttApiKey}
                  onChange={(v) => set("sttApiKey", v)}
                  configured={values.sttConfigured}
                />
              </Grid>
              <Grid>
                <Field label="Model" value={form.sttModel} onChange={(v) => set("sttModel", v)} placeholder="whisper-1" mono />
                <Field
                  label="Local model"
                  value={form.sttLocalModel}
                  onChange={(v) => set("sttLocalModel", v)}
                  placeholder="Systran/faster-whisper-small"
                  mono
                />
              </Grid>
              <Field
                label="Language hint"
                value={form.sttLanguage}
                onChange={(v) => set("sttLanguage", v)}
                placeholder="auto, or e.g. en / ru"
                mono
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
