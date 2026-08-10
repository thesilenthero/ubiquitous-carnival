export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function daysBetween(a: string, b: string = new Date().toISOString()) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = daysBetween(iso);
  if (d === 0) return "today";
  if (d > 0) return `${d}d ago`;
  return `in ${-d}d`;
}

export function fmtSalary(min: number | null, max: number | null): string {
  const f = (n: number) =>
    n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
  if (min && max) return `${f(min)}–${f(max)}`;
  if (min) return `${f(min)}+`;
  if (max) return `up to ${f(max)}`;
  return "—";
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Next-action urgency for the follow-up view.
export type Urgency = "overdue" | "today" | "soon" | "later" | "none";
export function urgencyOf(nextActionDate: string | null): Urgency {
  if (!nextActionDate) return "none";
  const d = daysBetween(new Date().toISOString(), nextActionDate + "T00:00:00");
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 3) return "soon";
  return "later";
}

// File sizes for attachments. Resumes are KB-to-low-MB, so one decimal on MB
// and none on KB reads cleanly without being noisy.
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
