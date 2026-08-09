import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  useApplications,
  useContacts,
  useResolveSuggestion,
  useSetStage,
  useSettings,
  useSuggestions,
  useUpdateApplication,
  useUpdateContact,
  useUpdateSettings,
} from "../api";
import { SettingInput } from "../components/SettingInput";
import { StageBadge } from "../components/StageBadge";
import {
  DEFAULT_QUIET_DAYS,
  STAGE_LABELS,
  TERMINAL_STAGES,
  type Stage,
} from "../types";
import {
  daysBetween,
  fmtDate,
  relativeDays,
  urgencyOf,
  type Urgency,
} from "../lib/format";


const GROUP_ORDER: Urgency[] = ["overdue", "today", "soon", "later"];
const GROUP_LABEL: Record<Urgency, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Next 3 days",
  later: "Later",
  none: "No date",
};
const GROUP_COLOR: Record<Urgency, string> = {
  overdue: "#ef4444",
  today: "#f59e0b",
  soon: "#4f46e5",
  later: "#6b7280",
  none: "#6b7280",
};

// One open next action, whether it lives on an application or a contact.
interface ActionRow {
  key: string;
  kind: "application" | "contact";
  id: string;
  action: string;
  date: string | null;
  title: string; // company · role, or contact name · company
  link: string;
  stage?: Stage; // applications only
}

export default function FollowUps() {
  const { data: apps } = useApplications();
  const { data: contacts } = useContacts();
  const { data: suggestions } = useSuggestions();
  const update = useUpdateApplication();
  const updateContact = useUpdateContact();
  const setStage = useSetStage();
  const resolve = useResolveSuggestion();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  // An application has "gone quiet" when it's still open but nothing has been
  // logged for this long — a nudge to follow up or call it ghosted.
  const quietDays = settings?.quietDays ?? DEFAULT_QUIET_DAYS;

  const quiet = useMemo(
    () =>
      (apps ?? [])
        .filter(
          (a) =>
            !a.archived &&
            !(TERMINAL_STAGES as readonly string[]).includes(a.currentStage) &&
            daysBetween(a.stageChangedAt) > quietDays,
        )
        .sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt)),
    [apps, quietDays],
  );

  const groups = useMemo(() => {
    const rows: ActionRow[] = [
      ...(apps ?? [])
        .filter((a) => !a.archived && a.nextAction)
        .map(
          (a): ActionRow => ({
            key: `app-${a.id}`,
            kind: "application",
            id: a.id,
            action: a.nextAction!,
            date: a.nextActionDate,
            title: `${a.company} · ${a.roleTitle}`,
            link: `/application/${a.id}`,
            stage: a.currentStage,
          }),
        ),
      ...(contacts ?? [])
        .filter((c) => c.nextAction)
        .map(
          (c): ActionRow => ({
            key: `contact-${c.id}`,
            kind: "contact",
            id: c.id,
            action: c.nextAction!,
            date: c.nextActionDate,
            title: [c.name, c.company].filter(Boolean).join(" · "),
            link: `/contacts?open=${c.id}`,
          }),
        ),
    ];
    const byUrgency: Record<Urgency, ActionRow[]> = {
      overdue: [],
      today: [],
      soon: [],
      later: [],
      none: [],
    };
    for (const r of rows) byUrgency[urgencyOf(r.date)].push(r);
    for (const k of Object.keys(byUrgency) as Urgency[]) {
      byUrgency[k].sort((a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999"),
      );
    }
    return byUrgency;
  }, [apps, contacts]);

  const total = GROUP_ORDER.reduce((n, g) => n + groups[g].length, 0) +
    groups.none.length;

  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {total} open action{total === 1 ? "" : "s"} across your pipeline and
          contacts
        </p>
      </header>

      {total === 0 && quiet.length === 0 && (suggestions ?? []).length === 0 && (
        <div className="card p-10 text-center text-[var(--text-muted)]">
          Nothing to follow up on. Add a next action to any application.
        </div>
      )}

      {/* Suggested updates from external scans (e.g. a Gmail pass). Nothing is
          written to the stage log until Accept is clicked. */}
      {(suggestions ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
            Suggested updates
            <span className="text-[var(--text-muted)]">
              ({(suggestions ?? []).length}) — review before anything is logged
            </span>
          </h2>
          <div className="card divide-y divide-[var(--border)]">
            {(suggestions ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/application/${s.applicationId}`}
                    className="font-medium hover:underline"
                  >
                    {s.company}
                  </Link>
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {s.roleTitle}
                  </span>
                  <div className="text-xs text-[var(--text-muted)]">
                    → {STAGE_LABELS[s.suggestedStage]}
                    {s.occurredAt ? ` on ${fmtDate(s.occurredAt)}` : ""}
                    {s.evidence ? ` · ${s.evidence}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => resolve.mutate({ id: s.id, action: "accept" })}
                  title={`Append a ${STAGE_LABELS[s.suggestedStage]} event${s.occurredAt ? " dated when the evidence happened" : ""}`}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Accept
                </button>
                <button
                  onClick={() => resolve.mutate({ id: s.id, action: "dismiss" })}
                  title="Discard — nothing is written to the stage log"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {[...GROUP_ORDER, "none" as Urgency].map((g) =>
        groups[g].length === 0 ? null : (
          <section key={g} className="mb-6">
            <h2
              className="mb-2 flex items-center gap-2 text-sm font-semibold"
              style={{ color: GROUP_COLOR[g] }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: GROUP_COLOR[g] }}
              />
              {GROUP_LABEL[g]}
              <span className="text-[var(--text-muted)]">
                ({groups[g].length})
              </span>
            </h2>
            <div className="card divide-y divide-[var(--border)]">
              {groups[g].map((r) => (
                <div key={r.key} className="flex items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    title="Mark action done (clears it)"
                    onChange={() =>
                      r.kind === "application"
                        ? update.mutate({
                            id: r.id,
                            patch: { nextAction: null, nextActionDate: null },
                          })
                        : updateContact.mutate({
                            id: r.id,
                            patch: { nextAction: null, nextActionDate: null },
                          })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <Link to={r.link} className="font-medium hover:underline">
                      {r.action}
                    </Link>
                    <div className="text-xs text-[var(--text-muted)]">
                      {r.title}
                    </div>
                  </div>
                  {r.stage ? (
                    <StageBadge stage={r.stage} />
                  ) : (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-muted)]"
                      title="Networking contact — opens their card on the Contacts page"
                    >
                      Contact
                    </span>
                  )}
                  <div className="w-24 text-right text-xs text-[var(--text-muted)]">
                    {r.date ? (
                      <>
                        {fmtDate(r.date)}
                        <div>{relativeDays(r.date)}</div>
                      </>
                    ) : (
                      "no date"
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ),
      )}

      {/* Always rendered so the time-to-ghost threshold stays editable even
          when nothing currently qualifies. */}
      <section className="mb-6">
        <h2
          className="mb-2 flex cursor-help items-center gap-2 text-sm font-semibold text-amber-500"
          title={`Open, unarchived applications with no stage event in ${quietDays}+ days, stalest first`}
        >
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Gone quiet
          <span className="text-[var(--text-muted)]">
            ({quiet.length}) — open with no movement in
          </span>
          <label
            className="flex cursor-auto items-center gap-1 font-normal text-[var(--text-muted)]"
            title="Your time-to-ghost threshold — how long silence lasts before an application lands here"
          >
            <SettingInput
              value={quietDays}
              min={1}
              max={365}
              onSave={(n) => updateSettings.mutate({ quietDays: n })}
              className="w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-right text-xs outline-none focus:border-[var(--accent)]"
            />
            + days
          </label>
        </h2>
        {quiet.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--text-muted)]">
            No open application has been silent for {quietDays}+ days.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--border)]">
            {quiet.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/application/${a.id}`}
                    className="font-medium hover:underline"
                  >
                    {a.company}
                  </Link>
                  <div className="text-xs text-[var(--text-muted)]">
                    {a.roleTitle}
                  </div>
                </div>
                <StageBadge stage={a.currentStage} />
                <span className="w-16 text-right text-xs font-medium text-amber-500">
                  {daysBetween(a.stageChangedAt)}d quiet
                </span>
                <button
                  onClick={() => setStage.mutate({ id: a.id, stage: "ghosted" })}
                  title="Record a ghosted event"
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                >
                  Mark ghosted
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
