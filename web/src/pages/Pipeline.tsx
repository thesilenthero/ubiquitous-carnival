import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useApplications,
  useSetStage,
  useSettings,
  useUpdateApplication,
  useUpdateSettings,
} from "../api";
import {
  ALL_STAGES,
  DEFAULT_STALE_DAYS,
  INDUSTRIES,
  ROLE_TYPES,
  SOURCES,
  STAGE_LABELS,
  TERMINAL_STAGES,
  type Application,
  type Stage,
} from "../types";
import { SettingInput } from "../components/SettingInput";
import { StageBadge } from "../components/StageBadge";
import { StagePicker } from "../components/StagePicker";
import { NewApplicationModal } from "../components/NewApplicationModal";
import { Board } from "../components/Board";
import { daysBetween, fmtDate, fmtSalary, relativeDays } from "../lib/format";
import { VERDICTS, VERDICT_COLORS } from "../lib/evaluation";

type SortKey =
  | "dateApplied"
  | "stage"
  | "company"
  | "source"
  | "inStage"
  | "nextActionDate";
type SortDir = "asc" | "desc";

// Direction a column starts in when first clicked — dates and staleness read
// most-recent/stalest first, text columns alphabetically.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  dateApplied: "desc",
  stage: "asc",
  company: "asc",
  source: "asc",
  inStage: "desc",
  nextActionDate: "asc",
};

const isTerminal = (s: Stage) =>
  (TERMINAL_STAGES as readonly string[]).includes(s);

export const daysInStage = (a: Application) =>
  Math.max(0, daysBetween(a.stageChangedAt));

export const isStale = (a: Application, staleDays: number) =>
  !isTerminal(a.currentStage) && daysInStage(a) > staleDays;

type View = "table" | "board";
const VIEW_KEY = "pipeline-view";

export default function Pipeline() {
  const { data: apps, isLoading } = useApplications();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const setStage = useSetStage();
  const update = useUpdateApplication();
  const navigate = useNavigate();
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;

  const [showNew, setShowNew] = useState(false);
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [roleTypeFilter, setRoleTypeFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dateApplied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(
    () => (localStorage.getItem(VIEW_KEY) as View) ?? "table",
  );

  const switchView = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  const rows = useMemo(() => {
    let list = (apps ?? []).filter((a) => showArchived || !a.archived);
    if (stageFilter !== "all")
      list = list.filter((a) => a.currentStage === stageFilter);
    if (sourceFilter !== "all")
      list = list.filter((a) => a.source === sourceFilter);
    if (industryFilter !== "all")
      list = list.filter((a) => a.industry === industryFilter);
    if (roleTypeFilter !== "all")
      list = list.filter((a) => a.roleType === roleTypeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      const has = (v: string | null) => (v ?? "").toLowerCase().includes(q);
      list = list.filter(
        (a) =>
          has(a.company) ||
          has(a.roleTitle) ||
          has(a.notes) ||
          has(a.location) ||
          has(a.industry),
      );
    }
    const stageOrder = (s: Stage) => ALL_STAGES.indexOf(s);
    const cmp = (a: Application, b: Application): number => {
      switch (sortKey) {
        case "company":
          return a.company.localeCompare(b.company);
        case "source":
          return a.source.localeCompare(b.source);
        case "stage":
          return stageOrder(a.currentStage) - stageOrder(b.currentStage);
        case "inStage":
          return daysInStage(a) - daysInStage(b);
        case "nextActionDate":
          return (a.nextActionDate ?? "9999").localeCompare(
            b.nextActionDate ?? "9999",
          );
        default:
          return a.dateApplied.localeCompare(b.dateApplied);
      }
    };
    return [...list].sort((a, b) => (sortDir === "asc" ? cmp(a, b) : cmp(b, a)));
  }, [
    apps,
    stageFilter,
    sourceFilter,
    industryFilter,
    roleTypeFilter,
    showArchived,
    search,
    sortKey,
    sortDir,
  ]);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allVisibleSelected =
    rows.length > 0 && visibleSelected.length === rows.length;

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const bulkArchive = async (archived: boolean) => {
    await Promise.all(
      visibleSelected
        .filter((a) => a.archived !== archived)
        .map((a) => update.mutateAsync({ id: a.id, patch: { archived } })),
    );
    setSelected(new Set());
  };

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {rows.length} application{rows.length === 1 ? "" : "s"} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {(["table", "board"] as const).map((v) => (
              <button
                key={v}
                title={
                  v === "table"
                    ? "Sortable table with bulk actions"
                    : "Kanban board — drag cards between stage columns"
                }
                onClick={() => switchView(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  view === v
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {v === "table" ? "Table" : "Board"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            + New application
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search company, role, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <Select
          value={stageFilter}
          onChange={(v) => setStageFilter(v as Stage | "all")}
          options={[
            ["all", "All stages"],
            ...ALL_STAGES.map((s) => [s, STAGE_LABELS[s]] as [string, string]),
          ]}
        />
        <Select
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            ["all", "All sources"],
            ...SOURCES.map((s) => [s, s] as [string, string]),
          ]}
        />
        <Select
          value={industryFilter}
          onChange={setIndustryFilter}
          options={[
            ["all", "All industries"],
            ...INDUSTRIES.map((s) => [s, s] as [string, string]),
          ]}
        />
        <Select
          value={roleTypeFilter}
          onChange={setRoleTypeFilter}
          options={[
            ["all", "All role types"],
            ...ROLE_TYPES.map((s) => [s, s] as [string, string]),
          ]}
        />
        <label
          className="ml-1 flex items-center gap-1.5 text-sm text-[var(--text-muted)]"
          title="Include archived applications in the list"
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived
        </label>
        <label
          className="ml-auto flex items-center gap-1 text-xs text-[var(--text-muted)]"
          title="Open applications with no stage event for this many days get the amber stale marker"
        >
          stale after
          <SettingInput
            value={staleDays}
            min={1}
            max={365}
            onSave={(n) => updateSettings.mutate({ staleDays: n })}
          />
          d
        </label>
      </div>

      {view === "board" ? (
        <Board
          apps={rows}
          onOpen={(id) => navigate(`/application/${id}`)}
          onStage={(id, stage) => setStage.mutate({ id, stage })}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      title="Select all shown"
                    />
                  </th>
                  <SortableTh
                    label="Company / Role"
                    active={sortKey === "company"}
                    dir={sortDir}
                    onClick={() => sortBy("company")}
                  />
                  <SortableTh
                    label="Source"
                    active={sortKey === "source"}
                    dir={sortDir}
                    onClick={() => sortBy("source")}
                  />
                  <SortableTh
                    label="Applied"
                    active={sortKey === "dateApplied"}
                    dir={sortDir}
                    onClick={() => sortBy("dateApplied")}
                  />
                  <SortableTh
                    label="Stage"
                    active={sortKey === "stage"}
                    dir={sortDir}
                    onClick={() => sortBy("stage")}
                  />
                  <SortableTh
                    label="In stage"
                    active={sortKey === "inStage"}
                    dir={sortDir}
                    onClick={() => sortBy("inStage")}
                    tip={`Days since the last stage event — open applications past ${staleDays} days are flagged stale`}
                  />
                  <Th>Update</Th>
                  <SortableTh
                    label="Next action"
                    active={sortKey === "nextActionDate"}
                    dir={sortDir}
                    onClick={() => sortBy("nextActionDate")}
                  />
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-8 text-center text-[var(--text-muted)]"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-10 text-center text-[var(--text-muted)]"
                    >
                      No applications yet. Add your first one.
                    </td>
                  </tr>
                )}
                {rows.map((a) => (
                  <Row
                    key={a.id}
                    app={a}
                    staleDays={staleDays}
                    selected={selected.has(a.id)}
                    onSelect={() => toggleSelected(a.id)}
                    onOpen={() => navigate(`/application/${a.id}`)}
                    onStage={(stage) => setStage.mutate({ id: a.id, stage })}
                    onArchive={() =>
                      update.mutate({
                        id: a.id,
                        patch: { archived: !a.archived },
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {visibleSelected.length > 0 && view === "table" && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="card flex items-center gap-3 px-4 py-2.5 shadow-lg">
            <span className="text-sm font-medium">
              {visibleSelected.length} selected
            </span>
            <button
              onClick={() => bulkArchive(true)}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Archive
            </button>
            <button
              onClick={() => bulkArchive(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--surface-2)]"
            >
              Unarchive
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {showNew && <NewApplicationModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({
  app,
  staleDays,
  selected,
  onSelect,
  onOpen,
  onStage,
  onArchive,
}: {
  app: Application;
  staleDays: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onStage: (s: Stage) => void;
  onArchive: () => void;
}) {
  const days = daysInStage(app);
  const stale = isStale(app, staleDays);
  return (
    <tr
      className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]"
      onClick={onOpen}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onSelect} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 font-medium">
          {app.company}
          {app.jobUrl && (
            <a
              href={app.jobUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open job posting"
              className="text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              ↗
            </a>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)]">{app.roleTitle}</div>
        {(app.industry || app.roleType || app.evalComposite != null) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {app.evalComposite != null && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                style={{
                  background: app.evalVerdict
                    ? VERDICT_COLORS[app.evalVerdict]
                    : "var(--text-muted)",
                }}
                title={
                  app.evalVerdict
                    ? `Evaluation: ${VERDICTS[app.evalVerdict].label}`
                    : "Evaluation"
                }
              >
                Fit {app.evalComposite}
              </span>
            )}
            {app.industry && (
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {app.industry}
              </span>
            )}
            {app.roleType && (
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                {app.roleType}
              </span>
            )}
          </div>
        )}
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">
          {app.remote ? "Remote" : app.location || ""}
          {app.salaryMin || app.salaryMax
            ? ` · ${fmtSalary(app.salaryMin, app.salaryMax)}`
            : ""}
        </div>
      </td>
      <td className="px-4 py-3 text-[var(--text-muted)]">{app.source}</td>
      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(app.dateApplied)}</td>
      <td className="px-4 py-3">
        <StageBadge stage={app.currentStage} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={stale ? "font-medium text-amber-500" : "text-[var(--text-muted)]"}
          title={stale ? `No movement in ${days} days` : undefined}
        >
          {stale && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
          {days}d
        </span>
      </td>
      <td className="px-4 py-3">
        <StagePicker value={app.currentStage} onChange={onStage} />
      </td>
      <td className="px-4 py-3 text-xs">
        {app.nextAction ? (
          <div>
            <div className="text-[var(--text)]">{app.nextAction}</div>
            <div className="text-[var(--text-muted)]">
              {app.nextActionDate ? relativeDays(app.nextActionDate) : ""}
            </div>
          </div>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title={app.archived ? "Unarchive" : "Archive"}
          className="rounded px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--border)]"
        >
          {app.archived ? "Unarchive" : "Archive"}
        </button>
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  tip,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  tip?: string;
}) {
  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        onClick={onClick}
        title={tip ?? `Sort by ${label.toLowerCase()} (click again to flip)`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-[var(--text)] ${
          active ? "text-[var(--text)]" : ""
        }`}
      >
        {label}
        <span className={active ? "" : "invisible"}>
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
