import { Field, Select, TextArea } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro } from "./ui.tsx";

const PRESETS = [
  { value: "companion", label: "Companion — present & honest" },
  { value: "sage", label: "Sage — calm & reflective" },
  { value: "pip", label: "Pip — bright & playful" },
  { value: "coach", label: "Coach — direct & motivating" },
];

export function PersonaSection({ form, set }: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="Persona"
        blurb="Who the companion is, and who it speaks to. The character below is written in plain language — it applies the moment you save."
      />
      <div className="flex flex-col gap-5">
        <Card title="Identity">
          <Grid>
            <Field label="Companion's name" value={form.name} onChange={(v) => set("name", v)} placeholder="Victoria" />
            <Field label="Your name" value={form.owner} onChange={(v) => set("owner", v)} placeholder="Traveler" />
          </Grid>
          <Select
            label="Starting archetype"
            value={form.preset}
            onChange={(v) => set("preset", v)}
            options={PRESETS}
            help="Used only when the character below is left blank."
          />
        </Card>

        <Card title="Character">
          <TextArea
            label="Persona"
            value={form.persona}
            onChange={(v) => set("persona", v)}
            rows={14}
            mono
            placeholder="# Identity&#10;You are…"
            help="Markdown. Voice, manner, what they know about you, what they care about. Leave empty to fall back to the archetype."
          />
        </Card>
      </div>
    </div>
  );
}
