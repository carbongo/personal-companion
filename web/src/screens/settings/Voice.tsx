import { Field, Secret, Select, Slider } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro } from "./ui.tsx";

const STT = [
  { value: "off", label: "Off — no transcription" },
  { value: "openai", label: "OpenAI-compatible (Whisper API)" },
  { value: "whisper-http", label: "Local Whisper (speaches / faster-whisper)" },
  { value: "local", label: "whisper.cpp — on this machine (whisper-cli)" },
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

        {!off && (
          <Card title="Language detection">
            <Field
              label="Detect model"
              value={form.sttDetectModel}
              onChange={(v) => set("sttDetectModel", v)}
              placeholder="blank = use the main model"
              mono
              help="A small, fast model run first just to guess the spoken language — the main model then transcribes with that language fixed instead of guessing it itself, which is both quicker and more accurate."
            />
            <Field
              label="Spoken languages"
              value={form.sttLanguages}
              onChange={(v) => set("sttLanguages", v)}
              placeholder="en, ru"
              mono
              help="The languages you actually speak, comma-separated. The detector's guess is clamped to this list, so a mumble never gets misheard as some unrelated language you don't use."
            />
            <Slider
              label="No-speech threshold"
              value={form.sttNoSpeechThreshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => set("sttNoSpeechThreshold", v)}
              help="How confident the model must be that a clip contains no speech before its output is discarded as a hallucination — background noise sometimes gets 'transcribed' into fluent nonsense, and this catches it."
            />
            <Slider
              label="Minimum clip length"
              value={form.sttMinClipMs}
              min={0}
              max={2000}
              step={50}
              suffix="ms"
              onChange={(v) => set("sttMinClipMs", v)}
              help="Clips shorter than this are too brief to trust — very short audio is where the model is most likely to invent words rather than transcribe real speech."
            />
            <Slider
              label="Entropy threshold"
              value={form.sttEntropyThreshold}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => set("sttEntropyThreshold", v)}
              help="Rejects a transcription when the model was unusually uncertain about which words to pick — a sign it guessed rather than heard."
            />
            <Slider
              label="Logprob threshold"
              value={form.sttLogprobThreshold}
              min={-5}
              max={0}
              step={0.1}
              onChange={(v) => set("sttLogprobThreshold", v)}
              help="Rejects a transcription when the model's own confidence in its words falls below this floor — another guard against confidently-wrong text."
            />
          </Card>
        )}
      </div>
    </div>
  );
}
