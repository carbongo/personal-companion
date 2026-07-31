import { Field, Secret, Select, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

const TTS = [
  { value: "off", label: "Off — no voice replies" },
  { value: "openai", label: "OpenAI-compatible (TTS API)" },
  { value: "http", label: "Self-hosted TTS server (HTTP)" },
  { value: "local", label: "Piper — on this machine (local)" },
];

export function SpeakingSection({ form, set, values }: SectionProps) {
  const off = form.ttsProvider === "off";
  return (
    <div>
      <SectionIntro
        title="Speaking"
        blurb="Turn replies into spoken audio (text-to-speech), and decide when the companion should actually speak up."
      />
      <div className="flex flex-col gap-5">
        <Card title="Text-to-speech">
          <Select label="Engine" value={form.ttsProvider} onChange={(v) => set("ttsProvider", v)} options={TTS} />
          {!off && (
            <>
              <Grid>
                <Field
                  label="API URL"
                  value={form.ttsApiUrl}
                  onChange={(v) => set("ttsApiUrl", v)}
                  placeholder="http://localhost:8880"
                  mono
                />
                <Secret
                  label="API key"
                  value={form.ttsApiKey}
                  onChange={(v) => set("ttsApiKey", v)}
                  configured={values.ttsConfigured}
                />
              </Grid>
              <Grid>
                <Field label="Model" value={form.ttsModel} onChange={(v) => set("ttsModel", v)} placeholder="tts-1" mono />
                <Field label="Voice" value={form.ttsVoice} onChange={(v) => set("ttsVoice", v)} placeholder="alloy" mono />
              </Grid>
              <Field
                label="Local model"
                value={form.ttsLocalModel}
                onChange={(v) => set("ttsLocalModel", v)}
                placeholder="en_US-lessac-medium.onnx"
                mono
              />
            </>
          )}
        </Card>
        <Card title="When to speak">
          <ToggleRow title="Mirror voice" desc="Reply in voice when you send a voice message.">
            <Toggle checked={form.speakMirror} onChange={(v) => set("speakMirror", v)} />
          </ToggleRow>
          <ToggleRow title="On request" desc="Reply in voice when you ask for it.">
            <Toggle checked={form.speakOnRequest} onChange={(v) => set("speakOnRequest", v)} />
          </ToggleRow>
          <ToggleRow title="Sometimes" desc="Let the companion decide when a voice reply fits better.">
            <Toggle checked={form.speakSometimes} onChange={(v) => set("speakSometimes", v)} />
          </ToggleRow>
        </Card>
      </div>
    </div>
  );
}
