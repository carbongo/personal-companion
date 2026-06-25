import { Field, Secret, Select, Slider, Toggle } from "../../components/Field.tsx";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro, ToggleRow } from "./ui.tsx";

const SEARCH = [
  { value: "duckduckgo", label: "DuckDuckGo — keyless" },
  { value: "tavily", label: "Tavily — API key" },
];

export function WebSection({ form, set, values }: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="The Sight"
        blurb="Bounded access to the open web — search and fetch, guarded against private addresses. The companion uses it only when it asks to."
      />
      <div className="flex flex-col gap-5">
        <Card title="Web access">
          <ToggleRow title="Allow web access" desc="Let the companion search and read pages within strict limits.">
            <Toggle checked={form.webEnabled} onChange={(v) => set("webEnabled", v)} />
          </ToggleRow>
          {form.webEnabled && (
            <>
              <Grid>
                <Select
                  label="Search provider"
                  value={form.webSearchProvider}
                  onChange={(v) => set("webSearchProvider", v)}
                  options={SEARCH}
                />
                {form.webSearchProvider === "tavily" && (
                  <Secret
                    label="Tavily API key"
                    value={form.tavilyKey}
                    onChange={(v) => set("tavilyKey", v)}
                    configured={values.tavilyConfigured}
                  />
                )}
              </Grid>
              <Grid>
                <Slider label="Steps per turn" value={form.webSteps} min={1} max={6} onChange={(v) => set("webSteps", v)} />
                <Slider label="Results per search" value={form.webResults} min={1} max={10} onChange={(v) => set("webResults", v)} />
              </Grid>
              <Grid>
                <Field
                  label="Page characters read"
                  value={String(form.webPageChars)}
                  onChange={(v) => set("webPageChars", Number(v) || 0)}
                  inputMode="numeric"
                  mono
                />
                <Field
                  label="Max requests / step"
                  value={String(form.webMaxReqs)}
                  onChange={(v) => set("webMaxReqs", Number(v) || 0)}
                  inputMode="numeric"
                  mono
                />
                <Field
                  label="Search timeout (ms)"
                  value={String(form.webSearchTimeoutMs)}
                  onChange={(v) => set("webSearchTimeoutMs", Number(v) || 0)}
                  inputMode="numeric"
                  mono
                />
                <Field
                  label="Fetch timeout (ms)"
                  value={String(form.webFetchTimeoutMs)}
                  onChange={(v) => set("webFetchTimeoutMs", Number(v) || 0)}
                  inputMode="numeric"
                  mono
                />
              </Grid>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
