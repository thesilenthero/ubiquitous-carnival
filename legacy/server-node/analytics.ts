import { db } from "./db.js";
import {
  FUNNEL_STAGES,
  TERMINAL_STAGES,
  type Stage,
} from "./domain.js";
import { getSettings } from "./settings.js";

// Every figure here is computed on read from the event log, so the numbers
// always reflect the live state of the pipeline. There is no refresh cycle:
// the frontend simply re-requests this after any mutation.

const DAY_MS = 24 * 60 * 60 * 1000;

type AppRow = {
  id: string;
  source: string;
  industry: string | null;
  role_type: string | null;
  date_applied: string;
  created_at: string;
};
type EventRow = { application_id: string; stage: string; occurred_at: string };

export interface FunnelStep {
  stage: Stage;
  reached: number; // applications that ever reached this stage
  conversionFromPrev: number | null; // reached / reached(prev)
  dropOffFromPrev: number | null; // reached(prev) - reached
}

export interface StageDuration {
  stage: Stage;
  count: number;
  medianDays: number;
  p75Days: number;
  maxDays: number;
  avgDays: number;
}

// A conversion breakdown for one value of some dimension (an industry, a role
// type, …) — volume plus how far that slice progresses.
export interface DimensionStat {
  key: string;
  applied: number;
  reachedScreen: number;
  reachedOffer: number;
  screenRate: number; // reachedScreen / applied
  offerRate: number; // reachedOffer / applied
}

export interface WeeklyPoint {
  weekStart: string; // ISO date of the Monday
  count: number;
}

export interface Analytics {
  totals: {
    applications: number;
    active: number; // not in a terminal stage
    offers: number;
    rejected: number;
    ghosted: number;
    withdrawn: number;
  };
  screenRate: number;
  // Share of applications with any event beyond "applied" — with a pipeline
  // where most rows end rejected/ghosted this is the most telling top line.
  responseRate: number;
  // Median days from the applied event to the first non-applied event,
  // across applications that got any response at all. Null if none have.
  medianDaysToFirstResponse: number | null;
  funnel: FunnelStep[];
  // Conversion compared across the values of each dimension.
  dimensions: {
    industry: DimensionStat[];
    roleType: DimensionStat[];
  };
  perWeek: WeeklyPoint[];
  timeInStage: StageDuration[];
  // Applications-per-week goal vs. actual pace.
  pace: {
    target: number;
    thisWeek: number;
    weekStart: string; // Monday of the current week
    last4Avg: number; // mean of the 4 completed weeks before this one
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00.000Z");
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Optional date-applied window: only applications applied within [from, to]
// (inclusive, ISO dates) are counted; their events follow them out naturally
// since every metric is derived per-application.
export function computeAnalytics(range?: {
  from?: string;
  to?: string;
}): Analytics {
  let apps = db
    .prepare<[], AppRow>(
      `SELECT id, source, industry, role_type, date_applied, created_at
       FROM applications`,
    )
    .all();
  if (range?.from) apps = apps.filter((a) => a.date_applied >= range.from!);
  if (range?.to) apps = apps.filter((a) => a.date_applied <= range.to!);
  const appIds = new Set(apps.map((a) => a.id));
  const events = db
    .prepare<[], EventRow>(
      `SELECT application_id, stage, occurred_at FROM stage_events
       ORDER BY occurred_at ASC, id ASC`,
    )
    .all()
    .filter((e) => appIds.has(e.application_id));

  // Group events per application.
  const byApp = new Map<string, EventRow[]>();
  for (const e of events) {
    (byApp.get(e.application_id) ?? byApp.set(e.application_id, []).get(e.application_id)!).push(e);
  }

  // "Ever reached" set of stages per application.
  const reachedByApp = new Map<string, Set<string>>();
  for (const [appId, evs] of byApp) {
    reachedByApp.set(appId, new Set(evs.map((e) => e.stage)));
  }

  const reachedCount = (stage: Stage) => {
    let n = 0;
    for (const set of reachedByApp.values()) if (set.has(stage)) n++;
    return n;
  };

  // ---- Funnel ----
  const funnel: FunnelStep[] = FUNNEL_STAGES.map((stage, i) => {
    const reached = reachedCount(stage);
    if (i === 0) {
      return { stage, reached, conversionFromPrev: null, dropOffFromPrev: null };
    }
    const prev = reachedCount(FUNNEL_STAGES[i - 1]);
    return {
      stage,
      reached,
      conversionFromPrev: prev > 0 ? reached / prev : null,
      dropOffFromPrev: prev - reached,
    };
  });

  const appliedN = reachedCount("applied");
  const screenN = reachedCount("screen");
  const screenRate = appliedN > 0 ? screenN / appliedN : 0;

  // ---- Response metrics ----
  // A "response" is the first event beyond the applied seed — a screen, an
  // interview, even a straight rejection. Ghosted does NOT count: it records
  // the absence of a reply, and counting it would peg the rate at 100%.
  let responded = 0;
  const daysToResponse: number[] = [];
  for (const evs of byApp.values()) {
    const applied = evs.find((e) => e.stage === "applied");
    const first = evs.find((e) => e.stage !== "applied" && e.stage !== "ghosted");
    if (!first) continue;
    responded++;
    if (applied) {
      const days =
        (new Date(first.occurred_at).getTime() -
          new Date(applied.occurred_at).getTime()) /
        DAY_MS;
      if (days >= 0) daysToResponse.push(days);
    }
  }
  const responseRate = apps.length > 0 ? responded / apps.length : 0;
  daysToResponse.sort((a, b) => a - b);
  const medianDaysToFirstResponse =
    daysToResponse.length > 0 ? round1(quantile(daysToResponse, 0.5)) : null;

  // ---- Current-stage totals ----
  const currentStageByApp = new Map<string, string>();
  for (const [appId, evs] of byApp) {
    currentStageByApp.set(appId, evs[evs.length - 1].stage);
  }
  let active = 0,
    offers = 0,
    rejected = 0,
    ghosted = 0,
    withdrawn = 0;
  const terminal = new Set<string>(TERMINAL_STAGES);
  for (const cur of currentStageByApp.values()) {
    if (cur === "offer") offers++;
    if (cur === "rejected") rejected++;
    if (cur === "ghosted") ghosted++;
    if (cur === "withdrawn") withdrawn++;
    if (!terminal.has(cur) && cur !== "offer") active++;
  }

  // ---- Dimension breakdowns (conversion, not just volume) ----
  // Compare how each slice of the pipeline progresses. Reused for every
  // dimension so adding one is a one-liner.
  const breakdownBy = (keyOf: (a: AppRow) => string | null): DimensionStat[] => {
    const m = new Map<string, { applied: number; screen: number; offer: number }>();
    for (const app of apps) {
      const key = keyOf(app);
      if (!key) continue; // skip unclassified rows for this dimension
      const set = reachedByApp.get(app.id) ?? new Set();
      const s = m.get(key) ?? { applied: 0, screen: 0, offer: 0 };
      s.applied++;
      if (set.has("screen")) s.screen++;
      if (set.has("offer")) s.offer++;
      m.set(key, s);
    }
    return [...m.entries()]
      .map(([key, s]) => ({
        key,
        applied: s.applied,
        reachedScreen: s.screen,
        reachedOffer: s.offer,
        screenRate: s.applied > 0 ? s.screen / s.applied : 0,
        offerRate: s.applied > 0 ? s.offer / s.applied : 0,
      }))
      .sort((a, b) => b.applied - a.applied);
  };
  const dimensions = {
    industry: breakdownBy((a) => a.industry),
    roleType: breakdownBy((a) => a.role_type),
  };

  // ---- Applications per week ----
  const weekMap = new Map<string, number>();
  for (const app of apps) {
    if (!app.date_applied) continue;
    const wk = mondayOf(app.date_applied);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + 1);
  }
  const perWeek: WeeklyPoint[] = [...weekMap.entries()]
    .map(([weekStart, count]) => ({ weekStart, count }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ---- Weekly pace vs. goal ----
  const currentWeekStart = mondayOf(new Date().toISOString().slice(0, 10));
  const prev4 = [1, 2, 3, 4].map((i) => {
    const d = new Date(currentWeekStart + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() - 7 * i);
    return d.toISOString().slice(0, 10);
  });
  const pace = {
    target: getSettings().weeklyTarget,
    thisWeek: weekMap.get(currentWeekStart) ?? 0,
    weekStart: currentWeekStart,
    last4Avg: round1(
      prev4.reduce((s, wk) => s + (weekMap.get(wk) ?? 0), 0) / 4,
    ),
  };

  // ---- Time-in-stage distribution ----
  const now = Date.now();
  const durations = new Map<string, number[]>();
  for (const evs of byApp.values()) {
    for (let i = 0; i < evs.length; i++) {
      const start = new Date(evs[i].occurred_at).getTime();
      const isLast = i === evs.length - 1;
      const end = isLast ? now : new Date(evs[i + 1].occurred_at).getTime();
      // Skip ongoing time for terminal stages — they are endpoints, not waits.
      if (isLast && terminal.has(evs[i].stage)) continue;
      const days = Math.max(0, (end - start) / DAY_MS);
      (durations.get(evs[i].stage) ?? durations.set(evs[i].stage, []).get(evs[i].stage)!).push(days);
    }
  }
  const timeInStage: StageDuration[] = FUNNEL_STAGES.map((stage) => {
    const arr = (durations.get(stage) ?? []).slice().sort((a, b) => a - b);
    const avg = arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    return {
      stage,
      count: arr.length,
      medianDays: round1(quantile(arr, 0.5)),
      p75Days: round1(quantile(arr, 0.75)),
      maxDays: round1(arr.length ? arr[arr.length - 1] : 0),
      avgDays: round1(avg),
    };
  });

  return {
    totals: {
      applications: apps.length,
      active,
      offers,
      rejected,
      ghosted,
      withdrawn,
    },
    screenRate,
    responseRate,
    medianDaysToFirstResponse,
    funnel,
    dimensions,
    perWeek,
    timeInStage,
    pace,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
