import { useSheetsStatus, useSyncSheets } from "../api";

// Status of the Google Sheet mirror (server/sheets_sync.py). The server pushes
// after every change on its own, so this is a window, not a control panel: it
// exists to answer "is the backup actually current?" — and to say why not when
// a mirror has quietly stopped working, which is the one thing you don't want
// to discover on the day you need the backup.
//
// Renders nothing when the Sheet isn't configured. Setup is on the server (two
// env vars, see README), so there'd be nothing here to click.

function syncedLabel(iso: string): string {
  const then = new Date(iso);
  const sameDay = then.toDateString() === new Date().toDateString();
  return sameDay
    ? then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : then.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function SheetsCard() {
  const { data } = useSheetsStatus();
  const sync = useSyncSheets();

  if (!data?.configured) return null;

  // A push that failed leaves the message on the status; a push that failed
  // just now leaves it on the mutation. Either way there's one line to show.
  const error = sync.error instanceof Error ? sync.error.message : data.lastError;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Google Sheet</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {data.lastSyncedAt
              ? `Five tabs, mirrored after every change. Last synced ${syncedLabel(data.lastSyncedAt)}.`
              : "Five tabs, mirrored after every change. Nothing pushed yet this run."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data.sheetUrl && (
            <a
              className="btn"
              href={data.sheetUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          )}
          <button
            className="btn"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--danger)]">
          {error}
        </div>
      )}
    </section>
  );
}
