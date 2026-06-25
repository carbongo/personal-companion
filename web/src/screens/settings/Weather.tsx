import { useRef, useState } from "react";
import { Field } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { api, type GeocodeResult } from "../../lib/api.ts";
import { sfx } from "../../lib/sound.ts";
import type { SectionProps } from "./types.ts";
import { Card, Grid, SectionIntro } from "./ui.tsx";

export function WeatherSection({ form, set }: SectionProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = (text: string) => {
    setQ(text);
    clearTimeout(debounce.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.geocode(text);
        setResults(r.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
  };

  const choose = (r: GeocodeResult) => {
    set("weatherLat", r.latitude.toFixed(4));
    set("weatherLon", r.longitude.toFixed(4));
    set("weatherLocationName", [r.name, r.admin1, r.country].filter(Boolean).join(", "));
    setResults([]);
    setQ("");
    sfx.play("confirm");
  };

  return (
    <div>
      <SectionIntro
        title="The Sky"
        blurb="Where you are, so the companion knows your weather and the shape of your day."
      />
      <div className="flex flex-col gap-5">
        <Card title="Location">
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              className="field pl-9"
              placeholder="Search a city…"
              value={q}
              onChange={(e) => search(e.target.value)}
            />
            {searching && (
              <Icon name="restart" size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-cyan" />
            )}
          </div>
          {results.length > 0 && (
            <div className="flex flex-col gap-1 overflow-hidden rounded-xl border border-[var(--line)] bg-black/25">
              {results.map((r) => (
                <button
                  key={`${r.latitude},${r.longitude}`}
                  onClick={() => choose(r)}
                  className="flex items-center justify-between px-3.5 py-2.5 text-left text-[13.5px] text-ink-dim transition hover:bg-cyan/10 hover:text-ink"
                >
                  <span>
                    {r.name}
                    {r.admin1 ? `, ${r.admin1}` : ""} <span className="text-ink-faint">· {r.country}</span>
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {r.latitude.toFixed(2)}, {r.longitude.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {form.weatherLocationName && (
            <div className="flex items-center gap-2 rounded-xl border border-cyan/25 bg-cyan/5 px-3.5 py-2.5 text-[13.5px] text-ink">
              <Icon name="weather" size={16} className="text-cyan" />
              {form.weatherLocationName}
            </div>
          )}

          <Grid>
            <Field label="Latitude" value={form.weatherLat} onChange={(v) => set("weatherLat", v)} placeholder="43.24" mono />
            <Field label="Longitude" value={form.weatherLon} onChange={(v) => set("weatherLon", v)} placeholder="76.89" mono />
          </Grid>
        </Card>
      </div>
    </div>
  );
}
