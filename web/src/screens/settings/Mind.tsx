import { useState } from "react";
import { Field, Secret, Select, Slider } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { api } from "../../lib/api.ts";
import { sfx } from "../../lib/sound.ts";
import { testBodyFromForm, type SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro } from "./ui.tsx";

const PROVIDERS = [
  { value: "ollama", label: "Ollama — local, private" },
  { value: "openai-compatible", label: "OpenAI-compatible endpoint" },
  { value: "anthropic", label: "Anthropic (use a compatible gateway)" },
];

export function MindSection({ form, set, values }: SectionProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const isOllama = form.provider === "ollama";

  const attune = async () => {
    setTesting(true);
    setResult(null);
    sfx.play("open");
    try {
      const r = await api.testModel(testBodyFromForm(form));
      setResult(r);
      sfx.play(r.ok ? "confirm" : "error");
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
      sfx.play("error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <SectionIntro
        title="The Mind"
        blurb="The model that thinks behind the companion. Keep it local with Ollama, or point at any OpenAI-compatible endpoint."
      />
      <div className="flex flex-col gap-5">
        <Card title="Model">
          <Grid>
            <Select label="Provider" value={form.provider} onChange={(v) => set("provider", v)} options={PROVIDERS} />
            <Field label="Model" value={form.model} onChange={(v) => set("model", v)} placeholder="gemma3:12b" mono />
          </Grid>
          <Field
            label="Vision model (for images)"
            value={form.visionModel}
            onChange={(v) => set("visionModel", v)}
            placeholder={isOllama ? "qwen2.5vl:7b — leave blank if the model above can see" : "leave blank to use the model above"}
            mono
            help="Used only for turns that include an image, when the main model can't see. Leave blank if the main model is already vision-capable."
          />
          {isOllama ? (
            <Field
              label="Ollama URL"
              value={form.ollamaUrl}
              onChange={(v) => set("ollamaUrl", v)}
              placeholder="http://localhost:11434"
              mono
            />
          ) : (
            <Grid>
              <Field
                label="Base URL"
                value={form.baseUrl}
                onChange={(v) => set("baseUrl", v)}
                placeholder="https://api.example.com/v1"
                mono
              />
              <Secret label="API key" value={form.apiKey} onChange={(v) => set("apiKey", v)} configured={false} />
            </Grid>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button className="btn amber" onClick={attune} disabled={testing}>
              <Icon name={testing ? "restart" : "sparkle"} size={16} className={testing ? "animate-spin" : ""} />
              {testing ? "Attuning…" : "Attune — test connection"}
            </button>
            {result && (
              <span
                className={`flex items-center gap-2 text-[13px] ${result.ok ? "text-jade" : "text-danger"}`}
              >
                <Icon name={result.ok ? "check" : "close"} size={15} />
                {result.detail}
              </span>
            )}
          </div>
        </Card>

        <Card title="Temperament">
          <Slider
            label="Temperature"
            value={form.temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set("temperature", v)}
            help="Lower is steadier and more focused; higher is more surprising."
          />
          <Grid>
            <Field
              label="Context window (tokens)"
              value={String(form.numCtx)}
              onChange={(v) => set("numCtx", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
            <Field
              label="Max reply tokens"
              value={String(form.maxTokens)}
              onChange={(v) => set("maxTokens", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
            <Field
              label="History turns kept"
              value={String(form.historyLimit)}
              onChange={(v) => set("historyLimit", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
            <Field
              label="Timeout (ms)"
              value={String(form.timeoutMs)}
              onChange={(v) => set("timeoutMs", Number(v) || 0)}
              inputMode="numeric"
              mono
            />
          </Grid>
          <Select
            label="Reasoning ('thinking')"
            value={form.think}
            onChange={(v) => set("think", v)}
            options={[
              { value: "false", label: "Off — answer directly" },
              { value: "true", label: "On — deliberate first (slower)" },
            ]}
            help={`Current model: ${values.provider} · ${values.model || "none"}`}
          />
        </Card>
      </div>
    </div>
  );
}
