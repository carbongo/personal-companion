import { Field, Select, Slider, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

const VAD_PROVIDERS = [
  { value: "auto", label: "Auto — Silero when its model file is present, energy otherwise" },
  { value: "silero", label: "Silero — small ONNX model, hears speech over background noise" },
  { value: "energy", label: "Energy — simple loudness threshold, no model file needed" },
];

export function CallingSection({ form, set }: SectionProps) {
  const off = !form.callEnabled;
  return (
    <div>
      <SectionIntro
        title="Calling"
        blurb="Live voice calls over Discord: always listening for speech, deciding when you're done talking, and — if you talk over it — stopping to listen. Text channels are unaffected."
      />
      <div className="flex flex-col gap-5">
        <Card title="Call engine">
          <ToggleRow
            title="Enable live calling"
            desc="Requires Discord to be configured under Channels; off means the bot never joins a call even if invited."
          >
            <Toggle checked={form.callEnabled} onChange={(v) => set("callEnabled", v)} />
          </ToggleRow>
        </Card>

        {!off && (
          <>
            <Card title="Hearing">
              <Select
                label="Voice-activity detector"
                value={form.callVadProvider}
                onChange={(v) => set("callVadProvider", v)}
                options={VAD_PROVIDERS}
              />
              <Slider
                label="Speech threshold"
                value={form.callVadThreshold}
                min={0.1}
                max={0.9}
                step={0.05}
                onChange={(v) => set("callVadThreshold", v)}
                help="How confident the detector must be that audio is speech, not room noise, before it counts. Higher is stricter."
              />
              <Slider
                label="Minimum speech length"
                value={form.callMinSpeechMs}
                min={0}
                max={1000}
                step={50}
                suffix="ms"
                onChange={(v) => set("callMinSpeechMs", v)}
                help="Utterances shorter than this are discarded as noise — a cough, a chair creak — rather than sent to transcription."
              />
            </Card>

            <Card title="Deciding you're done">
              <Slider
                label="Silence before an answer"
                value={form.callSilenceMs}
                min={200}
                max={2500}
                step={50}
                suffix="ms"
                onChange={(v) => set("callSilenceMs", v)}
                help="How long you can pause mid-thought before the companion takes its turn — the endpointing patience."
              />
              <Slider
                label="Max utterance length"
                value={form.callMaxUtteranceMs}
                min={5000}
                max={60000}
                step={1000}
                suffix="ms"
                onChange={(v) => set("callMaxUtteranceMs", v)}
                help="A hard cap so a stuck-open mic, or a very long ramble, can't hold the floor forever."
              />
            </Card>

            <Card title="Patience">
              <Slider
                label="Base patience"
                value={form.callPatienceMs}
                min={200}
                max={3000}
                step={50}
                suffix="ms"
                onChange={(v) => set("callPatienceMs", v)}
                help="How long she waits after you go quiet before deciding you've finished speaking, for an ordinary sentence."
              />
              <Slider
                label="Extended patience"
                value={form.callPatienceExtendedMs}
                min={500}
                max={5000}
                step={50}
                suffix="ms"
                onChange={(v) => set("callPatienceExtendedMs", v)}
                help="How much longer she'll wait when what you said sounds unfinished — trailing off on 'and', 'so', a hesitation like 'um' — rather than cutting in mid-thought."
              />
              <Slider
                label="Maximum patience"
                value={form.callPatienceMaxMs}
                min={1000}
                max={8000}
                step={100}
                suffix="ms"
                onChange={(v) => set("callPatienceMaxMs", v)}
                help="The absolute ceiling on how long she'll hold off replying, even for the most unfinished-sounding pause, so a long silence still gets a turn eventually."
              />
            </Card>

            <Card title="Interrupting">
              <ToggleRow
                title="Allow barge-in"
                desc="Let new speech from you cut the companion's playback short, the way a real conversation does."
              >
                <Toggle checked={form.callBargeIn} onChange={(v) => set("callBargeIn", v)} />
              </ToggleRow>
            </Card>

            <Card title="Model">
              <Grid>
                <Field
                  label="Call provider override"
                  value={form.callProvider}
                  onChange={(v) => set("callProvider", v)}
                  placeholder="blank = same as The Mind"
                  mono
                />
                <Field
                  label="Call model override"
                  value={form.callModel}
                  onChange={(v) => set("callModel", v)}
                  placeholder="blank = same as The Mind"
                  mono
                />
              </Grid>
              <p className="text-[12.5px] text-ink-faint">
                Leave both blank to use the model configured under The Mind. Set these only if calls should
                run on a faster or smaller model than the rest of the companion — calls have a tight latency
                budget, so a lighter model here can feel more responsive.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
