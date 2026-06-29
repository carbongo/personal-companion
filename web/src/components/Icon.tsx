/** Hand-drawn line glyphs — thin strokes, rounded joints, faintly runic. */
import type { ReactNode } from "react";

export type IconName =
  | "chat"
  | "settings"
  | "persona"
  | "brain"
  | "memory"
  | "channels"
  | "web"
  | "voice"
  | "weather"
  | "security"
  | "appearance"
  | "advanced"
  | "send"
  | "mic"
  | "image"
  | "sound"
  | "mute"
  | "close"
  | "check"
  | "checks"
  | "search"
  | "trash"
  | "plus"
  | "restart"
  | "sparkle"
  | "eye"
  | "eyeOff"
  | "chevron"
  | "owner";

const P: Record<IconName, ReactNode> = {
  chat: <path d="M4 5h16v10H9l-4 4v-4H4z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  persona: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    </>
  ),
  brain: (
    <>
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 1 5 3 3 0 0 0 3 3" />
      <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-1 5 3 3 0 0 1-3 3" />
      <path d="M12 4v16" />
    </>
  ),
  memory: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h6" />
    </>
  ),
  channels: <path d="M21 4L3 11l6 2 2 6 3-5 4 4z" />,
  web: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.5 2.5 13 0 16M12 4c-2.5 2.5-2.5 13 0 16" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  weather: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M15 18a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A3 3 0 0 0 6 18z" />
    </>
  ),
  security: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
  appearance: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16 4 4 0 0 1 0-8 4 4 0 0 0 0-8z" />
    </>
  ),
  advanced: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M5 18l5-5 4 4 2-2 3 3" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5 9-11" />,
  checks: (
    <>
      <path d="M2 13l4 4 8-10" />
      <path d="M11 14l2.5 3 8-10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4-4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  restart: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />,
  sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />,
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: <path d="M4 4l16 16M9.5 9.5A3 3 0 0 0 14.5 14.5M6 6.5C3.8 8 2 12 2 12s4 7 10 7a10 10 0 0 0 4-.8M9 5.2A10 10 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-2.2 3" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  owner: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M12 2.5l1 1.6 1 1.6" opacity="0.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
