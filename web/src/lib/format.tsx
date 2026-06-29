/**
 * Small presentational helpers: clock formatting and a deliberately tiny,
 * safe markdown renderer for chat (bold / italic / inline code / links / line
 * breaks). No HTML injection — everything is built as React nodes.
 */
import { Fragment, type ReactNode } from "react";

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still awake";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(INLINE);
  parts.forEach((part, i) => {
    const key = `${keyBase}-${i}`;
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-soft">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else if (part.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (m) {
        out.push(
          <a key={key} href={m[2]} target="_blank" rel="noreferrer" className="text-cyan underline decoration-cyan/40 underline-offset-2">
            {m[1]}
          </a>,
        );
      } else {
        out.push(<Fragment key={key}>{part}</Fragment>);
      }
    } else {
      out.push(<Fragment key={key}>{part}</Fragment>);
    }
  });
  return out;
}

export function renderMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line, `l${i}`)}
    </Fragment>
  ));
}
