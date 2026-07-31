import type { SectionProps } from "./types.ts";
import { SectionIntro } from "./ui.tsx";

export function SpeakingSection(_props: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="Speaking"
        blurb="Speaking (text-to-speech) is coming in a future update."
      />
    </div>
  );
}
