import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  useApplications,
  useContacts,
  useResolveSuggestion,
  useSettings,
  useSuggestions,
  useUpdateApplication,
  useUpdateContact,
  useUpdateSettings,
} from "../api";
import { SettingInput } from "../components/SettingInput";
import { StageBadge } from "../components/StageBadge";
import { SuggestedActions } from "../components/SuggestedActions";
import { DEFAULT_QUIET_DAYS, STAGE_LABELS, type Stage } from "../types";
import {
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
// Tokens, not literals, so the urgency ramp follows the theme.
const GROUP_COLOR: Record<Urgency, string> = {
  overdue: "var(--danger)",
  today: "var(--warning)",
  soon: "var(--accent)",
  later: "var(--text-muted)",
  none: "var(--text-muted)",
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

// Two queues on one page, in the order you'd work them: what the pipeline
// implies you should do (computed, server/next_steps.py), then what you've
// already committed to (dated, and yours). Acting on a suggestion writes a
// next action, so items move down the page rather than piling up at the top.
export default function NextSteps() {
  const { data: apps } = useApplications();
  const { data: contacts } = useContacts();
  const { data: suggestions } = useSuggestions();
  const update = useUpdateApplication();
  const updateContact = useUpdateContact();
  const resolve = useResolveSuggestion();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  // How long silence lasts before the engine starts suggesting you chase it.
  // Edited here because this is the page where its effect is visible.
  const quietDays = settings?.quietDays ?? DEFAULT_QUIET_DAYS;

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
        <h1 className="page-title">Next steps</h1>
        <p className="text-sm text-[var(--text-muted)]">
          {total} scheduled action{total === 1 ? "" : "s"} across your pipeline
          and contacts
        </p>
      </header>

      <SuggestedActions
        trailing={
          <label
            className="flex cursor-auto items-center gap-1 font-normal text-[var(--text-muted)]"
            title="Your time-to-ghost threshold — how long an application stays silent before it's suggested for follow-up"
          >
            quiet after
            <SettingInput
              value={quietDays}
              min={1}
              max={365}
              onSave={(n) => updateSettings.mutate({ quietDays: n })}
              className="input w-14 text-right text-xs"
            />
            days
          </label>
        }
      />

      {/* Suggested updates from external scans (e.g. a Gmail pass). Unlike the
          actions above, these propose writing to the STAGE LOG, so they stay a
          separate queue with their own accept/dismiss. */}
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
                  className="btn btn-primary btn-sm"
                >
                  Accept
                </button>
                <button
                  onClick={() => resolve.mutate({ id: s.id, action: "dismiss" })}
                  title="Discard — nothing is written to the stage log"
                  className="btn btn-secondary btn-sm"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {total === 0 && (
        <div className="card empty">
          Nothing scheduled. Add a next action to any application, or take one
          of the suggestions above.
        </div>
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
    </div>
  );
}
