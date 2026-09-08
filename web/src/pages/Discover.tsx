import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useDiscovered,
  useRefreshBoards,
  useResolveDiscovered,
} from "../api";
import type { DiscoveredStatus } from "../types";
import { fmtDate } from "../lib/format";
import { SkeletonRows } from "../components/Skeleton";

const inputCls =
  "input w-full";

const TABS: { key: DiscoveredStatus; label: string }[] = [
  { key: "new", label: "New" },
  { key: "saved", label: "Saved" },
  { key: "docketed", label: "Docketed" },
  { key: "applied", label: "Applied" },
  { key: "dismissed", label: "Dismissed" },
];

const money = (n: number | null) =>
  n === null ? null : `$${Math.round(n / 1000)}k`;

function salaryLabel(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${money(min)}–${money(max)}`;
  return money(min ?? max);
}

// Postings found by polling the ATS boards of employers you're watching.
//
// Same contract as the suggestions inbox: this proposes, you decide. Save keeps
// something shortlisted without touching the pipeline; Docket creates a real
// application on the docket, so it can carry notes and an evaluation without
// claiming it was sent; Apply creates one dated today; Dismiss hides it.
// Nothing is polled until you press Refresh — there is no scheduler, and
// opening a page shouldn't fire network calls.
export default function Discover() {
  const { data: boards } = useBoards();
  const createBoard = useCreateBoard();
  const deleteBoard = useDeleteBoard();
  const refresh = useRefreshBoards();
  const resolve = useResolveDiscovered();

  const [tab, setTab] = useState<DiscoveredStatus>("new");
  const { data: jobs, isLoading } = useDiscovered(tab);

  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [company, setCompany] = useState("");
  const [showBoards, setShowBoards] = useState(false);

  async function addBoard(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      await createBoard.mutateAsync({
        url: url.trim(),
        keywords: keywords.trim(),
        company: company.trim() || undefined,
      });
      setUrl("");
      setKeywords("");
      setCompany("");
    } catch {
      /* the error is rendered from the mutation below */
    }
  }

  const result = refresh.data;

  return (
    <div className="max-w-3xl">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="text-sm text-[var(--text-muted)]">
            New postings from {(boards ?? []).length} watched board
            {(boards ?? []).length === 1 ? "" : "s"} — nothing reaches your
            pipeline until you apply
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || (boards ?? []).length === 0}
          title="Poll every active board now"
          className="btn btn-primary btn-sm shrink-0"
        >
          {refresh.isPending ? "Refreshing…" : "Refresh boards"}
        </button>
      </header>

      {refresh.isError && (
        <p className="mb-3 text-xs text-[var(--stage-rejected)]">
          {(refresh.error as Error).message}
        </p>
      )}
      {result && !refresh.isPending && (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Checked {result.checked} board{result.checked === 1 ? "" : "s"} ·{" "}
          {result.added} new posting{result.added === 1 ? "" : "s"}
          {result.errors.length > 0 && (
            <span className="text-[var(--stage-rejected)]">
              {" "}
              · {result.errors.length} failed: {result.errors.join("; ")}
            </span>
          )}
        </p>
      )}

      {/* Boards panel — collapsed by default; this is setup, not the daily view */}
      <section className="mb-5">
        <button
          onClick={() => setShowBoards((v) => !v)}
          className="mb-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {showBoards ? "▾" : "▸"} Watched boards ({(boards ?? []).length})
        </button>

        {showBoards && (
          <div className="card p-3">
            <form onSubmit={addBoard} className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <input
                  className={inputCls}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Careers board URL — e.g. https://omers.wd3.myworkdayjobs.com/en-US/OMERS_External"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className={inputCls}
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="Keywords: analyst, data, reporting"
                  />
                  <input
                    className={inputCls}
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Display name (optional)"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={!url.trim() || createBoard.isPending}
                className="btn btn-primary"
              >
                {createBoard.isPending ? "Adding…" : "Add board"}
              </button>
            </form>

            <p className="mb-3 text-xs text-[var(--text-muted)]">
              Workday, Greenhouse, Lever, Ashby, and SmartRecruiters boards.
              Keywords match the job title — without them a large employer will
              bury everything else.
            </p>

            {createBoard.isError && (
              <p className="mb-2 text-xs text-[var(--stage-rejected)]">
                {(createBoard.error as Error).message}
              </p>
            )}

            {(boards ?? []).length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">
                No boards yet. Paste a company's careers URL above.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {(boards ?? []).map((b) => (
                  <div key={b.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {b.company}
                        <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                          {b.ats}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {b.keywords || "no keyword filter — keeps everything"}
                        {b.lastCheckedAt
                          ? ` · checked ${fmtDate(b.lastCheckedAt)}`
                          : " · never checked"}
                      </div>
                      {b.lastError && (
                        <div className="text-xs text-[var(--stage-rejected)]">
                          {b.lastError}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Stop watching ${b.company}? Postings already found from it are removed too.`,
                          )
                        )
                          deleteBoard.mutate(b.id);
                      }}
                      className="text-xs text-[var(--danger)] hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Status tabs */}
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              tab === t.key
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <SkeletonRows rows={4} label="Loading postings" />}

      {!isLoading && (jobs ?? []).length === 0 && (
        <div className="card empty">
          {tab === "new"
            ? (boards ?? []).length === 0
              ? "Add a board above, then hit Refresh to find postings."
              : "Nothing new. Hit Refresh boards to check again."
            : `No ${tab} postings.`}
        </div>
      )}

      {!isLoading && (jobs ?? []).length > 0 && (
        <div className="card divide-y divide-[var(--border)]">
          {(jobs ?? []).map((j) => {
            const pay = salaryLabel(j.salaryMin, j.salaryMax);
            return (
              <div key={j.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={j.jobUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                    title="Open the posting"
                  >
                    {j.roleTitle}
                  </a>
                  <div className="text-xs text-[var(--text-muted)]">
                    {j.company}
                    {j.location ? ` · ${j.location}` : ""}
                    {j.remote ? " · Remote" : ""}
                    {pay ? ` · ${pay}` : ""}
                    {j.postedAt ? ` · ${j.postedAt}` : ""}
                  </div>
                </div>

                {j.status === "applied" && j.applicationId ? (
                  <Link
                    to={`/application/${j.applicationId}`}
                    className="btn btn-secondary btn-sm"
                  >
                    View application
                  </Link>
                ) : (
                  <>
                    {j.status !== "saved" && (
                      <button
                        onClick={() =>
                          resolve.mutate({ id: j.id, action: "save" })
                        }
                        title="Shortlist without adding it to your pipeline"
                        className="btn btn-secondary btn-sm"
                      >
                        Save
                      </button>
                    )}
                    <button
                      onClick={() =>
                        resolve.mutate({ id: j.id, action: "docket" })
                      }
                      title="Track it as a role you intend to apply to — it stays out of the funnel and out of analytics until you mark it applied"
                      className="btn btn-secondary btn-sm"
                    >
                      Add to docket
                    </button>
                    <button
                      onClick={() => resolve.mutate({ id: j.id, action: "apply" })}
                      title="Create an application dated today and fetch the full description"
                      className="btn btn-primary btn-sm"
                    >
                      Apply
                    </button>
                    {j.status !== "dismissed" && (
                      <button
                        onClick={() =>
                          resolve.mutate({ id: j.id, action: "dismiss" })
                        }
                        title="Hide it — it won't come back on the next refresh"
                        className="btn btn-secondary btn-sm"
                      >
                        Dismiss
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
