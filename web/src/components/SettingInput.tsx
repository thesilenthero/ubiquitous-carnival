import { useEffect, useRef, useState } from "react";

// A small number input bound to a persisted setting. Saves as you change it —
// spinner clicks and typing both commit (debounced), Enter and blur commit
// immediately. Out-of-range drafts are simply not saved.
export function SettingInput({
  value,
  min,
  max,
  onSave,
  title,
  className,
}: {
  value: number;
  min: number;
  max: number;
  onSave: (n: number) => void;
  title?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<number | undefined>(undefined);
  const saved = useRef(value);
  saved.current = value;

  // Resync when the persisted value changes elsewhere (or finishes loading).
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min && n <= max && n !== saved.current) {
      onSave(n);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      title={title}
      onChange={(e) => {
        setDraft(e.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(e.target.value), 400);
      }}
      onBlur={(e) => {
        window.clearTimeout(timer.current);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={
        className ??
        "input w-14 px-1.5 text-right text-xs"
      }
    />
  );
}
