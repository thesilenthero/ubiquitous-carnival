import { useState } from "react";
import {
  useApplications,
  useCreateEffort,
  useDeleteEffort,
  useEffortEntries,
} from "../api";
import { EFFORT_KINDS, EFFORT_KIND_KEYS, type EffortKind } from "../types";
import { fmtDate, todayIso } from "../lib/format";

// The hand-logged half of the effort score.
//
// Everything else the score counts is already in the tracker — applications,
// stage events, contact interactions — and is weighted server-side from rows
// that already exist. This is for the work that writes to nothing: the two days
// before a screen, a take-home, an hour of practice. Without it a prep week
// scores zero, which is the whole reason the metric was wrong before.
//
// One entry is one session. No hours field on purpose: a duration is a decision
// every single time you log, and the point is that logging has to be cheap
// enough to actually do on the day you're busy preparing.

export function LogEffortCard() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EffortKind>("interview-prep");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [appId, setAppId] = useState("");

  const { data: entries } = useEffortEntries({ limit: 8 });
  const { data: applications } = useApplications();
  const create = useCreateEffort();
  const remove = useDeleteEffort();

  function submit() {
    create.mutate(
      {
        kind,
        occurredAt: date,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(appId ? { applicationId: appId } : {}),
      },
      {
        onSuccess: () => {
          // Kind and date persist: logging two prep sessions for the same day
          // is the common case, and re-picking both every time is the friction
          // that stops you logging at all.
          setNote("");
          setAppId("");
        },
      },
    );
  }

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)]">
          Prep, take-homes and practice leave no other trace — log them here and
          they count.
        </span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Close" : "Log effort"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            What
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as EffortKind)}
            >
              {EFFORT_KIND_KEYS.map((k) => (
                <option key={k} value={k}>
                  {EFFORT_KINDS[k].label} · +{EFFORT_KINDS[k].weight}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            When
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex min-w-[12rem] flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            For (optional)
            <select
              className="input"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            >
              <option value="">No particular role</option>
              {(applications ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.roleTitle} at {a.company}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[11px] text-[var(--text-muted)]">
            Note (optional)
            <input
              className="input"
              value={note}
              placeholder="SQL drills, STAR stories…"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={create.isPending || !date}
          >
            {create.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {create.isError && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          {(create.error as Error).message}
        </p>
      )}

      {entries && entries.length > 0 && (
        <ul className="mt-3 space-y-1">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 text-xs text-[var(--text-muted)]"
            >
              <span className="tabular w-6 shrink-0 text-right font-medium text-[var(--text)]">
                +{e.weight}
              </span>
              <span className="text-[var(--text)]">{e.label}</span>
              <span className="shrink-0">{fmtDate(e.occurredAt)}</span>
              {e.applicationLabel && (
                <span className="truncate">· {e.applicationLabel}</span>
              )}
              {e.note && <span className="truncate">· {e.note}</span>}
              <button
                className="btn btn-ghost btn-sm ml-auto shrink-0"
                title="Remove this entry"
                onClick={() => remove.mutate(e.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
