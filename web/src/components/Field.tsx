/** Themed form primitives: labeled inputs, runic toggle, slider, select. */
import { type ReactNode, useId, useState } from "react";
import { sfx } from "../lib/sound.ts";
import { Icon } from "./Icon.tsx";

export function FieldShell({
  label,
  help,
  children,
  htmlFor,
}: {
  label?: string;
  help?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function Field({
  label,
  help,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
  inputMode,
}: {
  label?: string;
  help?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  const id = useId();
  return (
    <FieldShell label={label} help={help} htmlFor={id}>
      <input
        id={id}
        className={`field ${mono ? "font-mono text-[13px]" : ""}`}
        type={type}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function Secret({
  label,
  help,
  value,
  onChange,
  configured,
}: {
  label?: string;
  help?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  configured?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <FieldShell label={label} help={help} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          className="field pr-11 font-mono text-[13px]"
          type={show ? "text" : "password"}
          value={value}
          placeholder={configured ? "•••••••• (saved — leave blank to keep)" : "not set"}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-faint transition hover:text-cyan"
          onClick={() => {
            setShow((s) => !s);
            sfx.play("tap");
          }}
          aria-label={show ? "Hide" : "Show"}
        >
          <Icon name={show ? "eyeOff" : "eye"} size={17} />
        </button>
      </div>
    </FieldShell>
  );
}

export function TextArea({
  label,
  help,
  value,
  onChange,
  rows = 4,
  mono,
  placeholder,
}: {
  label?: string;
  help?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <FieldShell label={label} help={help} htmlFor={id}>
      <textarea
        id={id}
        className={`field ${mono ? "font-mono text-[13px] leading-relaxed" : ""}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function Select({
  label,
  help,
  value,
  onChange,
  options,
}: {
  label?: string;
  help?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <FieldShell label={label} help={help} htmlFor={id}>
      <div className="relative">
        <select
          id={id}
          className="field cursor-pointer appearance-none pr-10"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            sfx.play("tap");
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron"
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-ink-faint"
        />
      </div>
    </FieldShell>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onChange(!checked);
        sfx.play("toggle");
      }}
      className="group inline-flex items-center gap-3"
    >
      <span
        className={`relative h-[26px] w-[46px] rounded-full border transition-all duration-300 ${
          checked
            ? "border-cyan/60 bg-cyan/15 shadow-[0_0_18px_rgba(88,199,214,.35)]"
            : "border-[var(--line-strong)] bg-black/40"
        }`}
      >
        <span
          className={`absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full transition-all duration-300 ${
            checked ? "left-[24px] bg-cyan shadow-[0_0_12px_rgba(88,199,214,.8)]" : "left-[3px] bg-ink-faint"
          }`}
        />
      </span>
      {label && <span className="text-sm text-ink-dim">{label}</span>}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
  help,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  help?: ReactNode;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <FieldShell help={help}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="label !mb-0">{label}</span>
        <span className="font-mono text-[13px] text-cyan-soft">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider"
        style={{ ["--pct" as string]: `${pct}%` }}
      />
    </FieldShell>
  );
}
