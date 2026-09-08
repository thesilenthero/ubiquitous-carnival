// Every date in this app is a calendar date, not an instant. The bare
// `YYYY-MM-DD` fields (dateApplied, nextActionDate) already are one, and the
// timestamp fields (occurredAt, stageChangedAt) are a date the backend stamped
// at UTC midnight or noon — all but a couple of stage events carry no real time
// of day. So day math compares civil dates and never rounds a millisecond
// delta: that's what made a follow-up due tomorrow read "today" after noon.

/** The calendar day an ISO value denotes. Timestamps are read in UTC — the
 *  calendar the backend writes them in. */
export function civilDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Today on the user's wall clock, not UTC's. */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A date-only value as the timestamp the API stores. Noon UTC so the day
 *  survives a round-trip through `civilDate` from any timezone. */
export function isoFromDate(d: string): string {
  return `${d}T12:00:00.000Z`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(civilDate(iso) + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Whole calendar days from `a` to `b`; negative when `a` is the later day. */
export function daysBetween(a: string, b: string = todayIso()): number {
  const at = Date.parse(civilDate(a) + "T00:00:00Z");
  const bt = Date.parse(civilDate(b) + "T00:00:00Z");
  return Math.round((bt - at) / 86_400_000); // UTC anchors: exact, DST-free
}

export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = daysBetween(iso);
  if (d === 0) return "today";
  if (d > 0) return `${d}d ago`;
  return `in ${-d}d`;
}

// Pay, shown in the units it was entered in. An hourly rate is never converted
// to an annual figure: contract hours aren't a given, so any such number would
// be invented — and $62.50/hr is the figure that appears in the posting anyway.
export function fmtSalary(
  min: number | null,
  max: number | null,
  period: "year" | "hour" = "year",
): string {
  const hourly = period === "hour";
  // Cents matter at $62.50/hr and are noise at $120k, so the two scales round
  // differently: exact to the cent below $1000, to the nearest thousand above.
  const f = (n: number) =>
    hourly || n < 1000
      ? `$${n % 1 === 0 ? n : n.toFixed(2)}`
      : `$${Math.round(n / 1000)}k`;
  const unit = hourly ? "/hr" : "";
  if (min && max) return `${f(min)}–${f(max)}${unit}`;
  if (min) return `${f(min)}${unit}+`;
  if (max) return `up to ${f(max)}${unit}`;
  return "—";
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Next-action urgency for the follow-up view.
export type Urgency = "overdue" | "today" | "soon" | "later" | "none";
export function urgencyOf(nextActionDate: string | null): Urgency {
  if (!nextActionDate) return "none";
  const d = daysBetween(todayIso(), nextActionDate);
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
