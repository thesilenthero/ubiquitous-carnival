import { useState } from "react";
import { useSettings } from "../api";
import {
  DEFAULT_STALE_DAYS,
  FUNNEL_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  TERMINAL_STAGES,
  type Application,
  type Stage,
} from "../types";
import { daysBetween } from "../lib/format";

// Kanban view of the pipeline. One column per funnel stage plus a single
// "Closed" column that groups the terminal exits — nine separate columns
// would be unusable. Dropping a card on a column APPENDS a stage event via
// the same mutation the table's picker uses; dropping on Closed asks which
// terminal stage to record.
type Column = Stage | "closed";
const COLUMNS: Column[] = [...FUNNEL_STAGES, "closed"];

const isTerminal = (s: Stage) =>
  (TERMINAL_STAGES as readonly string[]).includes(s);

export function Board({
  apps,
  onOpen,
  onStage,
}: {
  apps: Application[];
  onOpen: (id: string) => void;
  onStage: (id: string, stage: Stage) => void;
}) {
  const [dragOver, setDragOver] = useState<Column | null>(null);
  // Card dropped on Closed: remember it and ask which terminal stage.
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const { data: settings } = useSettings();
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;

  const byColumn = new Map<Column, Application[]>(
    COLUMNS.map((c) => [c, []]),
  );
  for (const a of apps) {
    const col: Column = isTerminal(a.currentStage) ? "closed" : a.currentStage;
    byColumn.get(col)!.push(a);
  }

  const drop = (col: Column, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    if (col === "closed") {
      if (!isTerminal(app.currentStage)) setPendingClose(id);
      return;
    }
    if (app.currentStage !== col) onStage(id, col);
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {COLUMNS.map((col) => {
          const cards = byColumn.get(col)!;
          const color =
            col === "closed" ? "var(--text-muted)" : STAGE_COLORS[col];
          return (
            <div
              key={col}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col);
              }}
              onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
              onDrop={(e) => drop(col, e)}
              className={`w-60 shrink-0 rounded-xl border p-2 transition ${
                dragOver === col
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface-2)]"
              }`}
            >
              <div
                className="mb-2 flex items-center justify-between px-1"
                title={
                  col === "closed"
                    ? "Rejected, withdrawn, and ghosted — drop a card here to close it"
                    : `Drop a card here to record a ${STAGE_LABELS[col]} transition`
                }
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: color }}
                  />
                  {col === "closed" ? "Closed" : STAGE_LABELS[col]}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {cards.length}
                </span>
              </div>

              {col === "closed" && pendingClose && (
                <ClosePicker
                  onPick={(stage) => {
                    onStage(pendingClose, stage);
                    setPendingClose(null);
                  }}
                  onCancel={() => setPendingClose(null)}
                />
              )}

              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
                {cards.map((a) => (
                  <Card
                    key={a.id}
                    app={a}
                    staleDays={staleDays}
                    onOpen={() => onOpen(a.id)}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  app,
  staleDays,
  onOpen,
}: {
  app: Application;
  staleDays: number;
  onOpen: () => void;
}) {
  const days = Math.max(0, daysBetween(app.stageChangedAt));
  const stale = !isTerminal(app.currentStage) && days > staleDays;
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", app.id)}
      onClick={onOpen}
      className="cursor-grab rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-sm transition hover:border-[var(--accent)] active:cursor-grabbing"
    >
      <div className="text-sm font-medium">{app.company}</div>
      <div className="truncate text-xs text-[var(--text-muted)]">
        {app.roleTitle}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {isTerminal(app.currentStage) && (
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            {STAGE_LABELS[app.currentStage]}
          </span>
        )}
        {app.roleType && (
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            {app.roleType}
          </span>
        )}
        <span
          className={`ml-auto text-[10px] ${
            stale ? "font-semibold text-amber-500" : "text-[var(--text-muted)]"
          }`}
          title={stale ? `No movement in ${days} days` : undefined}
        >
          {days}d
        </span>
      </div>
    </div>
  );
}

function ClosePicker({
  onPick,
  onCancel,
}: {
  onPick: (stage: Stage) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-2">
      <div className="mb-1.5 text-xs font-medium">Close as…</div>
      <div className="flex flex-col gap-1">
        {TERMINAL_STAGES.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--surface-2)]"
          >
            {STAGE_LABELS[s]}
          </button>
        ))}
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
