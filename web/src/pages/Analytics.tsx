import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { useAnalytics, useUpdateSettings, type AnalyticsRange } from "../api";
import { SettingInput } from "../components/SettingInput";
import { STAGE_COLORS, STAGE_LABELS, type Stage } from "../types";
import { fmtDate, pct, todayIso } from "../lib/format";
import { ImportCard } from "../components/ImportCard";
import { SheetsCard } from "../components/SheetsCard";
import { Skeleton } from "../components/Skeleton";

// Themed tooltip so it isn't a white box in dark mode.
const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-md)",
  color: "var(--text)",
  fontSize: 12,
};

// Series identity is never colour alone — the legend names every series, and
// legend text wears the muted ink token rather than the series colour.
const LEGEND_STYLE = { fontSize: 11, color: "var(--text-muted)" };

// Grid and axes stay recessive so the marks carry the reading.
const GRID_STROKE = "color-mix(in srgb, var(--border) 70%, transparent)";
const TICK = { fontSize: 11, fill: "var(--text-muted)" };

const DIMENSIONS = [
  { key: "industry", label: "Industry" },
  { key: "roleType", label: "Role type" },
] as const;
type DimKey = (typeof DIMENSIONS)[number]["key"];

const PRESETS = [
  { key: "all", label: "All time", days: null },
  { key: "30d", label: "Last 30d", days: 30 },
  { key: "90d", label: "Last 90d", days: 90 },
  { key: "custom", label: "Custom", days: null },
] as const;
type PresetKey = (typeof PRESETS)[number]["key"];

// Range bounds are compared against `dateApplied`, a calendar date, so they are
// counted back from the user's local day rather than sliced out of a UTC string.
function daysAgoIso(days: number): string {
  const d = new Date(todayIso() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function Analytics() {
  const [preset, setPreset] = useState<PresetKey>("all");
  const [custom, setCustom] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });

  const range: AnalyticsRange =
    preset === "all"
      ? {}
      : preset === "custom"
        ? {
            ...(custom.from ? { from: custom.from } : {}),
            ...(custom.to ? { to: custom.to } : {}),
          }
        : { from: daysAgoIso(preset === "30d" ? 30 : 90) };

  const { data, isLoading } = useAnalytics(range);
  const [dim, setDim] = useState<DimKey>("industry");
  const updateSettings = useUpdateSettings();

  const rangePicker = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            title={
              p.key === "custom"
                ? "Pick an exact date-applied window"
                : p.days
                  ? `Only applications applied in the last ${p.days} days`
                  : "No date filter — every application"
            }
            onClick={() => setPreset(p.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              preset === p.key
                ? "bg-[var(--accent-fill)] text-[var(--on-accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <input
            type="date"
            value={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className="input"
          />
          –
          <input
            type="date"
            value={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className="input"
          />
        </span>
      )}
    </div>
  );

  if (isLoading || !data)
    return (
      <div role="status" aria-label="Loading analytics">
        <Skeleton className="mb-5 h-8 w-48" />
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );

  const {
    totals,
    funnel,
    screenRate,
    screenBasis,
    responseRate,
    medianDaysToFirstResponse,
    dimensions,
    perWeek,
    timeInStage,
    pace,
  } = data;
  const offerRate =
    totals.applications > 0 ? totals.offers / totals.applications : 0;
  const breakdown = dimensions[dim];

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Live — recomputed from the event log on every change.
          </p>
        </div>
        {rangePicker}
      </header>

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi
          label="Applications"
          value={totals.applications}
          tip="Total applications in the selected date range, including archived ones."
        />
        <Kpi
          label="Active"
          value={totals.active}
          accent
          tip="Applications whose current stage is not an offer or a terminal exit (rejected / withdrawn / ghosted)."
        />
        <Kpi
          label="On the docket"
          value={totals.docketed}
          sub="not yet applied"
          tip="Roles you want but haven't applied to. They are excluded from every other figure on this page — and from the date range — because there is no application yet to measure."
        />
        <Kpi
          label="Response rate"
          value={pct(responseRate)}
          sub="any reply ÷ applied"
          tip="Share of applications that got ANY reply — a screen, an interview, even a rejection. Ghosted doesn't count: it records the absence of a reply."
        />
        <Kpi
          label="Days to response"
          value={
            medianDaysToFirstResponse !== null
              ? `${medianDaysToFirstResponse}d`
              : "—"
          }
          sub="median"
          tip="Median days from applying to the first reply, across applications that got one."
        />
        <Kpi
          label="Screen rate"
          value={pct(screenRate)}
          sub={`screen ÷ ${screenBasis.matured} judged`}
          tip={`Applications that ever reached a screen ÷ the ones old enough to judge. An application counts once it has been answered, or once it has been out ${screenBasis.windowDays} days without a reply — expecting a callback on something you sent in yesterday would only make a productive week look like a bad one.`}
        />
        <Kpi
          label="Offer rate"
          value={pct(offerRate)}
          sub={`${totals.offers} offer(s)`}
          tip="Applications currently at offer ÷ all applications."
        />
      </div>

      {/* The screen-rate denominator, stated in the open — including what it is
          deliberately not counting yet, and the knob that decides. */}
      <div className="-mt-3 mb-5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <span>
          Screen rate is over {screenBasis.matured} application
          {screenBasis.matured === 1 ? "" : "s"} old enough to judge
          {screenBasis.pending > 0 && (
            <>
              {" — "}
              {screenBasis.pending} sent in the last {screenBasis.windowDays}{" "}
              day{screenBasis.windowDays === 1 ? "" : "s"}{" "}
              {screenBasis.pending === 1 ? "is" : "are"} still pending
            </>
          )}
          .
        </span>
        <label
          className="flex items-center gap-1"
          title="How long an application must be out before silence counts as no screen. Applications already answered count immediately, whatever their age."
        >
          window
          <SettingInput
            value={screenBasis.windowDays}
            min={1}
            max={365}
            onSave={(n) => updateSettings.mutate({ screenWindowDays: n })}
            className="input w-12 px-1.5 text-right text-[11px]"
          />
          days
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Funnel */}
        <section className="card p-5 lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold">Pipeline funnel</h3>
          <div className="space-y-2.5">
            {funnel.map((step) => {
              const top = funnel[0].reached || 1;
              const widthPct = Math.max((step.reached / top) * 100, 2);
              return (
                <div key={step.stage} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-right text-sm text-[var(--text-muted)]">
                    {STAGE_LABELS[step.stage]}
                  </div>
                  <div className="relative h-9 flex-1 overflow-hidden rounded-md bg-[var(--surface-2)]">
                    <div
                      className="flex h-full items-center rounded-md px-3 text-sm font-semibold text-[var(--on-stage)] transition-all"
                      style={{
                        width: `${widthPct}%`,
                        background: STAGE_COLORS[step.stage],
                        minWidth: 36,
                      }}
                    >
                      {step.reached}
                    </div>
                  </div>
                  <div className="w-28 shrink-0 text-xs text-[var(--text-muted)]">
                    {step.conversionFromPrev !== null ? (
                      <>
                        <span className="font-medium text-[var(--text)]">
                          {pct(step.conversionFromPrev)}
                        </span>{" "}
                        from prev
                        {step.dropOffFromPrev ? (
                          <div className="text-[var(--danger)]">
                            −{step.dropOffFromPrev} dropped
                          </div>
                        ) : null}
                      </>
                    ) : (
                      "top of funnel"
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
            <Outcome label="Offers" n={totals.offers} color="var(--stage-offer)" />
            <Outcome label="Rejected" n={totals.rejected} color="var(--stage-rejected)" />
            <Outcome label="Ghosted" n={totals.ghosted} color="var(--stage-ghosted)" />
            <Outcome label="Withdrawn" n={totals.withdrawn} color="var(--stage-withdrawn)" />
          </div>
        </section>

        {/* Applications per week + pace vs. goal */}
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Applications per week</h3>
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span
                className="cursor-help"
                title="Applications sent this week vs. your goal · average of the previous 4 completed weeks"
              >
                This week{" "}
                <span
                  className={`font-semibold ${
                    pace.thisWeek >= pace.target
                      ? "text-[var(--success)]"
                      : "text-[var(--text)]"
                  }`}
                >
                  {pace.thisWeek}/{pace.target}
                </span>
                {" · "}4-wk avg {pace.last4Avg}
              </span>
              <label
                className="flex items-center gap-1"
                title="Weekly application goal — drawn as the dashed line on the chart"
              >
                goal
                <SettingInput
                  value={pace.target}
                  min={1}
                  max={200}
                  onSave={(n) => updateSettings.mutate({ weeklyTarget: n })}
                />
              </label>
            </div>
          </div>
          {perWeek.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={perWeek} margin={{ left: -20, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="wk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="weekStart"
                  tickFormatter={(d) => fmtDate(d).replace(/,.*/, "")}
                  tick={TICK}
                />
                <YAxis
                  allowDecimals={false}
                  tick={TICK}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => `Week of ${fmtDate(d as string)}`}
                  formatter={(v) => [v as number, "Applications"]}
                />
                <ReferenceLine
                  y={pace.target}
                  stroke="var(--text-muted)"
                  strokeDasharray="4 4"
                  label={{
                    value: "goal",
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "var(--text-muted)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#wk)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Time in stage */}
        <section className="card p-5">
          <h3 className="mb-1 text-sm font-semibold">
            Time in stage (median days)
          </h3>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Where applications stall or go quiet.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={timeInStage}
              margin={{ left: -20, right: 8, top: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis
                dataKey="stage"
                tickFormatter={(s) => STAGE_LABELS[s as Stage]}
                tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={TICK} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "var(--surface-2)" }}
                labelFormatter={(s) => STAGE_LABELS[s as Stage]}
                formatter={(v, _n, p) => [
                  `${v} d median · ${(p as { payload: { p75Days: number } }).payload.p75Days} d p75`,
                  "Time in stage",
                ]}
              />
              <Bar dataKey="medianDays" radius={[4, 4, 0, 0]}>
                {timeInStage.map((t) => (
                  <Cell key={t.stage} fill={STAGE_COLORS[t.stage]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* Breakdown by dimension (compare conversion across slices) */}
        <section className="card p-5 lg:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Breakdown</h3>
            <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {DIMENSIONS.map((d) => (
                <button
                  key={d.key}
                  title={`Compare conversion across ${d.label.toLowerCase()} slices`}
                  onClick={() => setDim(d.key)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    dim === d.key
                      ? "bg-[var(--accent-fill)] text-[var(--on-accent)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Which {DIMENSIONS.find((d) => d.key === dim)!.label.toLowerCase()}{" "}
            slices convert — not just which produce volume.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={breakdown} margin={{ left: -20, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis
                  dataKey="key"
                  tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  allowDecimals={false}
                  tick={TICK}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--surface-2)" }} />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={28}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={LEGEND_STYLE}
                />
                <Bar dataKey="applied" name="Applied" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="reachedScreen" name="Reached screen" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="reachedOffer" name="Reached offer" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="py-2 pr-2 font-medium">
                      {DIMENSIONS.find((d) => d.key === dim)!.label}
                    </th>
                    <th className="py-2 pr-2 text-right font-medium">Applied</th>
                    <th
                      className="py-2 pr-2 text-right font-medium"
                      title={`Over the applications old enough to judge, not all of them — so a slice you applied to heavily this week isn't scored on replies that can't have arrived yet. Window: ${screenBasis.windowDays} days.`}
                    >
                      Screen %
                    </th>
                    <th className="py-2 text-right font-medium">Offer %</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((s) => (
                    <tr key={s.key} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 pr-2">{s.key}</td>
                      <td className="py-2 pr-2 text-right">{s.applied}</td>
                      <td
                        className="py-2 pr-2 text-right"
                        title={`${s.reachedScreen} of ${s.maturedApplied} judged`}
                      >
                        {pct(s.screenRate)}
                      </td>
                      <td className="py-2 text-right">{pct(s.offerRate)}</td>
                    </tr>
                  ))}
                  {breakdown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        No data for this dimension yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4">
        <SheetsCard />
        <ImportCard />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
  tip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  tip?: string;
}) {
  return (
    <div className={`card p-3.5 ${tip ? "cursor-help" : ""}`} title={tip}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div
        className="tabular mt-1.5 text-[22px] font-semibold leading-none tracking-tight"
        style={accent ? { color: "var(--accent)" } : undefined}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">{sub}</div>
      )}
    </div>
  );
}

function Outcome({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}: <span className="font-medium text-[var(--text)]">{n}</span>
    </span>
  );
}

function Empty() {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-[var(--text-muted)]">
      Not enough data yet.
    </div>
  );
}
