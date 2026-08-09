import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateApplication } from "../api";
import { SOURCES, type Application, type FetchedPosting } from "../types";
import { AutofillPosting } from "../components/AutofillPosting";
import {
  DIMENSIONS,
  REJECT_FLAGS,
  VERDICT_COLORS,
  assessmentSummary,
  computeComposite,
  emptyFlags,
  emptyScores,
  flagCaution,
  verdictFor,
  type DimensionKey,
  type Evaluation,
  type Flags,
  type Notes,
  type Scores,
} from "../lib/evaluation";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-xs font-medium text-[var(--text-muted)]";

const DRAFT_KEY = "job-tracker:evaluation-draft:v1";
const todayStr = () => new Date().toISOString().slice(0, 10);

interface Draft {
  company: string;
  roleTitle: string;
  source: string;
  dateApplied: string;
  jobUrl: string;
  jobDescription: string;
  scores: Scores;
  notes: Notes;
  flags: Flags;
  conclusion: string;
}

function freshDraft(): Draft {
  return {
    company: "",
    roleTitle: "",
    source: "Indeed",
    dateApplied: todayStr(),
    jobUrl: "",
    jobDescription: "",
    scores: emptyScores(),
    notes: {},
    flags: emptyFlags(),
    conclusion: "",
  };
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return freshDraft();
    const saved = JSON.parse(raw) as Partial<Draft>;
    // Merge onto a fresh draft so new dimensions/flags added later are covered.
    return {
      ...freshDraft(),
      ...saved,
      scores: { ...emptyScores(), ...(saved.scores ?? {}) },
      flags: { ...emptyFlags(), ...(saved.flags ?? {}) },
      notes: saved.notes ?? {},
    };
  } catch {
    return freshDraft();
  }
}

// The in-app job-role evaluation calculator — the interactive version of the
// `job-evaluation` skill. It is a throwaway calculator: nothing is persisted
// until "Convert to Application" saves the scored snapshot onto a new pipeline
// entry. An in-progress draft survives tab switches via localStorage.
export default function Evaluation() {
  const create = useCreateApplication();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [openAnchors, setOpenAnchors] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  // Persist the draft on every change so switching tabs doesn't lose work.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const composite = useMemo(() => computeComposite(draft.scores), [draft.scores]);
  const verdict = verdictFor(composite);
  const caution = flagCaution(draft.flags, verdict.key);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const setScore = (k: DimensionKey, v: number) =>
    setDraft((d) => ({ ...d, scores: { ...d.scores, [k]: v } }));
  const setNote = (k: DimensionKey, v: string) =>
    setDraft((d) => ({ ...d, notes: { ...d.notes, [k]: v } }));
  const toggleFlag = (k: keyof Flags) =>
    setDraft((d) => ({ ...d, flags: { ...d.flags, [k]: !d.flags[k] } }));

  // Autofill the posting half of the form. Never touches the scores — those
  // stay entirely yours.
  function applyParsed({ fields, jobDescription }: FetchedPosting, url: string | null) {
    setDraft((d) => ({
      ...d,
      company: fields.company || d.company,
      roleTitle: fields.roleTitle || d.roleTitle,
      jobUrl: url || d.jobUrl,
      jobDescription: jobDescription || d.jobDescription,
    }));
  }

  const canConvert = draft.company.trim() !== "" && draft.roleTitle.trim() !== "";

  function buildEvaluation(): Evaluation {
    return {
      scores: draft.scores,
      notes: draft.notes,
      flags: draft.flags,
      conclusion: draft.conclusion.trim(),
      composite,
      verdict: verdict.key,
    };
  }

  async function convert() {
    if (!canConvert) return;
    const evaluation = buildEvaluation();
    const created = await create.mutateAsync({
      company: draft.company.trim(),
      roleTitle: draft.roleTitle.trim(),
      source: draft.source,
      dateApplied: draft.dateApplied,
      jobUrl: draft.jobUrl.trim() || null,
      jobDescription: draft.jobDescription.trim() || null,
      evalComposite: composite,
      evalVerdict: verdict.key,
      evaluation,
    } as Partial<Application>);
    localStorage.removeItem(DRAFT_KEY);
    navigate(`/application/${created.id}`);
  }

  function reset() {
    if (!confirm("Clear this evaluation and start over?")) return;
    localStorage.removeItem(DRAFT_KEY);
    setDraft(freshDraft());
    setOpenAnchors({});
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(assessmentSummary(buildEvaluation()));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Job evaluation</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Score a posting across seven weighted dimensions, then convert a strong
          fit into a pipeline application. Nothing is saved until you convert.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Main column: the posting + the seven dimensions */}
        <div className="min-w-0 space-y-4">
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold">Posting</h3>
            <AutofillPosting className="mb-3" onResult={applyParsed} />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className={labelCls}>Company *</label>
                <input
                  className={inputCls}
                  value={draft.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="RBC"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={labelCls}>Role title *</label>
                <input
                  className={inputCls}
                  value={draft.roleTitle}
                  onChange={(e) => set("roleTitle", e.target.value)}
                  placeholder="Senior Analyst, Marketing Analytics"
                />
              </div>
              <div>
                <label className={labelCls}>Source</label>
                <select
                  className={inputCls}
                  value={draft.source}
                  onChange={(e) => set("source", e.target.value)}
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date seen</label>
                <input
                  type="date"
                  className={inputCls}
                  value={draft.dateApplied}
                  onChange={(e) => set("dateApplied", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Job posting URL</label>
                <input
                  type="url"
                  className={inputCls}
                  value={draft.jobUrl}
                  onChange={(e) => set("jobUrl", e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Job description</label>
                <textarea
                  className={inputCls}
                  rows={5}
                  value={draft.jobDescription}
                  onChange={(e) => set("jobDescription", e.target.value)}
                  placeholder="Paste the posting text — it carries over to the application and preserves the JD after the listing disappears."
                />
              </div>
            </div>
          </section>

          <section className="card p-4">
            <h3 className="mb-1 text-sm font-semibold">Dimensions</h3>
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Score each 0–10. Expand a dimension to see the scoring rubric.
            </p>
            <div className="space-y-3">
              {DIMENSIONS.map((d) => {
                const open = !!openAnchors[d.key];
                const score = draft.scores[d.key] ?? 0;
                return (
                  <div
                    key={d.key}
                    className="rounded-lg border border-[var(--border)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {d.label}{" "}
                          <span className="text-xs font-normal text-[var(--text-muted)]">
                            {d.weightPct}%
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {d.blurb}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={1}
                          value={score}
                          onChange={(e) => setScore(d.key, Number(e.target.value))}
                          className="w-28 accent-[var(--accent)]"
                          aria-label={`${d.label} score`}
                        />
                        <span className="w-8 text-right text-sm font-semibold tabular-nums">
                          {score}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenAnchors((s) => ({ ...s, [d.key]: !open }))
                        }
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        {open ? "Hide rubric" : "Show rubric"}
                      </button>
                    </div>
                    {open && (
                      <ul className="mt-2 space-y-1 rounded-lg bg-[var(--surface-2)] p-2.5 text-xs">
                        {d.anchors.map((a) => (
                          <li key={a.range} className="flex gap-2">
                            <span className="w-10 shrink-0 font-semibold tabular-nums text-[var(--text-muted)]">
                              {a.range}
                            </span>
                            <span>{a.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <textarea
                      className={`${inputCls} mt-2`}
                      rows={2}
                      value={draft.notes[d.key] ?? ""}
                      onChange={(e) => setNote(d.key, e.target.value)}
                      placeholder={`Why this score for ${d.label.toLowerCase()}…`}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card p-4">
            <h3 className="mb-1 text-sm font-semibold">Reject-fast flags</h3>
            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Advisory — a set flag raises a caution but doesn't change the score.
            </p>
            <div className="space-y-2">
              {REJECT_FLAGS.map((f) => (
                <label
                  key={f.key}
                  className="flex cursor-pointer items-start gap-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={draft.flags[f.key]}
                    onChange={() => toggleFlag(f.key)}
                  />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {f.blurb}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">Conclusion</h3>
            <textarea
              className={inputCls}
              rows={4}
              value={draft.conclusion}
              onChange={(e) => set("conclusion", e.target.value)}
              placeholder="Fit today? Strategically useful long-term? Improves or worsens the path toward stable decision-support work?"
            />
          </section>
        </div>

        {/* Aside: the live result + actions, sticky on wide screens */}
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <div className="card p-4">
            <div className="text-xs font-medium text-[var(--text-muted)]">
              Composite
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-bold tabular-nums">{composite}</span>
              <span className="text-lg text-[var(--text-muted)]">/ 100</span>
            </div>
            <div
              className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-white"
              style={{ background: VERDICT_COLORS[verdict.key] }}
            >
              {verdict.label}
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">{verdict.blurb}</p>

            {caution && (
              <p className="mt-3 rounded-lg bg-[var(--surface-2)] p-2.5 text-xs text-[var(--stage-rejected)]">
                ⚠ A reject-fast flag is set on an otherwise-applyable score. A
                hard structural negative can override a borderline composite —
                reconsider before applying.
              </p>
            )}

            {/* Per-dimension mini bars */}
            <div className="mt-4 space-y-1.5">
              {DIMENSIONS.map((d) => {
                const s = draft.scores[d.key] ?? 0;
                return (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-[10px] text-[var(--text-muted)]">
                      {d.label}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <span
                        className="block h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${s * 10}%` }}
                      />
                    </span>
                    <span className="w-5 text-right text-[10px] tabular-nums text-[var(--text-muted)]">
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>

            {create.isError && (
              <p className="mt-3 text-sm text-red-600">
                {(create.error as Error).message}
              </p>
            )}

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={convert}
                disabled={!canConvert || create.isPending}
                title={
                  canConvert
                    ? "Save this evaluation onto a new pipeline application"
                    : "Add a company and role title first"
                }
                className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {create.isPending ? "Converting…" : "Convert to application"}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copySummary}
                  className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                >
                  {copied ? "Copied ✓" : "Copy summary"}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
