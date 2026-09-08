import { useState } from "react";
import { fmtDate } from "../lib/format";

// Shared inline-edit field primitives, used by the application Detail view and
// the Contacts page. All save on blur/change and render as quiet text until
// hovered or focused.

export function EditableText({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== value) onSave(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`input-quiet border-[var(--accent)] ${className ?? ""}`}
      />
    );
  }
  return (
    <div
      className={`cursor-text rounded-[var(--radius-sm)] px-1 py-0.5 transition-colors duration-150 hover:bg-[var(--surface-2)] ${className ?? ""}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value}
    </div>
  );
}

export function FieldEdit({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 text-right">
        <input
          defaultValue={value}
          onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
          placeholder="—"
          className="input-quiet w-full text-right"
        />
      </dd>
    </div>
  );
}

export function FieldSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onSave,
}: {
  label: string;
  value: T;
  options: readonly T[];
  /** Display names, when the stored value isn't what you'd want to read
   *  ("onsite" → "On-site"). Falls back to the value itself. */
  labels?: Record<T, string>;
  onSave: (v: T) => void;
}) {
  // Tolerate a stored value outside the suggestion list (source is free text).
  const merged = options.includes(value) ? options : [value, ...options];
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd>
        <select
          value={value}
          onChange={(e) => onSave(e.target.value as T)}
          className="input-quiet"
        >
          {merged.map((o) => (
            <option key={o} value={o}>
              {labels?.[o] ?? o}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}

// A nullable select: a blank option plus suggestions, tolerant of a current
// value that isn't in the suggestion list.
export function FieldOptional({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: string | null;
  options: readonly string[];
  onSave: (v: string | null) => void;
}) {
  const merged =
    value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd>
        <select
          value={value ?? ""}
          onChange={(e) => onSave(e.target.value || null)}
          className="input-quiet max-w-[12rem]"
        >
          <option value="">—</option>
          {merged.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}

export function FieldDate({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">{fmtDate(value)}</span>
        <input
          type="date"
          defaultValue={value}
          onChange={(e) => e.target.value && onSave(e.target.value)}
          className="input-quiet"
        />
      </dd>
    </div>
  );
}

// An editable URL with an "open" link when set.
export function FieldUrl({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-[var(--text-muted)]">
        {label}
        {value && (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            title={`Open ${label.toLowerCase()}`}
            className="text-[var(--accent)] hover:underline"
          >
            ↗
          </a>
        )}
      </dt>
      <dd className="min-w-0 flex-1 text-right">
        <input
          type="url"
          defaultValue={value ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== value) onSave(v);
          }}
          placeholder="https://…"
          className="input-quiet w-full text-right"
        />
      </dd>
    </div>
  );
}

export function NumBox({
  value,
  onSave,
  step,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
  /** "0.01" for money with cents — the default step of 1 marks $62.50 invalid. */
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      defaultValue={value ?? ""}
      onBlur={(e) => {
        const v = e.target.value ? Number(e.target.value) : null;
        if (v !== value) onSave(v);
      }}
      placeholder="—"
      className="input-quiet w-20 text-right"
    />
  );
}
