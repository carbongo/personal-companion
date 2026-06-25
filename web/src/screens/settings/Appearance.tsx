import { useEffect, useState } from "react";
import { Toggle } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { sfx, useSound } from "../../lib/sound.ts";
import { Card, SectionIntro, ToggleRow } from "./ui.tsx";

const CUES = ["hover", "tap", "toggle", "open", "confirm", "receive", "error"] as const;

export function AppearanceSection() {
  const sound = useSound();
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div>
      <SectionIntro
        title="Atmosphere"
        blurb="How the Slate feels. These preferences live in this browser only — they never leave your device."
      />
      <div className="flex flex-col gap-5">
        <Card title="Sound">
          <ToggleRow title="Interface chimes" desc="Soft, synthesized cues on hover, send, and confirm.">
            <Toggle checked={sound.on} onChange={() => sound.toggle()} />
          </ToggleRow>
          <div>
            <div className="label">Audition the cues</div>
            <div className="flex flex-wrap gap-2">
              {CUES.map((c) => (
                <button
                  key={c}
                  onClick={() => sfx.play(c)}
                  onPointerEnter={() => sfx.play("hover")}
                  disabled={!sound.on}
                  className="pill capitalize transition hover:border-cyan/40 hover:text-cyan disabled:opacity-40"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Motion">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-black/15 px-4 py-3 text-[13.5px] text-ink-dim">
            <Icon name={reduced ? "eyeOff" : "sparkle"} size={18} className={reduced ? "text-amber" : "text-cyan"} />
            {reduced
              ? "Your system asks for reduced motion — the Slate keeps animation to a whisper."
              : "Full motion is on, following your system preference. Set 'reduce motion' in your OS to calm it."}
          </div>
        </Card>

        <Card title="Theme">
          <div className="flex items-center gap-3 text-[13.5px] text-ink-dim">
            <span className="h-5 w-5 rounded-full border border-cyan/50 bg-cyan/20 shadow-[0_0_12px_rgba(88,199,214,.5)]" />
            <span className="h-5 w-5 rounded-full border border-amber/50 bg-amber/20 shadow-[0_0_12px_rgba(224,168,60,.45)]" />
            <span className="ml-2">Nocturne · slate, cyan energy, amber activation</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
