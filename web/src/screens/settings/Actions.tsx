import type { SectionProps } from "./types.ts";
import { SectionIntro } from "./ui.tsx";

export function ActionsSection(_props: SectionProps) {
  return (
    <div>
      <SectionIntro
        title="Actions"
        blurb="Actions are coming in a future update."
      />
    </div>
  );
}
