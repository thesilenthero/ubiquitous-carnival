import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useApplication,
  useAddInterview,
  useDeleteInterview,
  useDeleteStageEvent,
  useSetStage,
  useUpdateApplication,
  useUpdateInterview,
  useUpdateStageEvent,
} from "../api";
import {
  ALL_STAGES,
  INDUSTRIES,
  INTERVIEW_FORMATS,
  ROLE_TYPES,
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  SOURCES,
  STAGE_COLORS,
  STAGE_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  type Application,
  type Interview,
  type SalaryPeriod,
  type Stage,
} from "../types";
import {
  EditableText,
  FieldDate,
  FieldEdit,
  FieldOptional,
  FieldSelect,
  FieldUrl,
  NumBox,
} from "../components/fields";
import { StageBadge } from "../components/StageBadge";
import { AttachmentSection } from "../components/AttachmentSection";
import { ContactPicker } from "../components/ContactPicker";
import { Skeleton } from "../components/Skeleton";
import { daysBetween, fmtDate, isoFromDate, todayIso } from "../lib/format";
import {
  DIMENSIONS,
  REJECT_FLAGS,
  VERDICTS,
  VERDICT_COLORS,
  type Evaluation as EvaluationSnapshot,
} from "../lib/evaluation";

export default function Detail() {
  const { id } = useParams();
  const { data: app, isLoading } = useApplication(id);
  const update = useUpdateApplication();
  const setStage = useSetStage();
  const delEvent = useDeleteStageEvent();
  const updateEvent = useUpdateStageEvent();
  const addInterview = useAddInterview();
  const navigate = useNavigate();

  const [newStage, setNewStage] = useState<Stage>("screen");
  const [stageNote, setStageNote] = useState("");
  const [stageDate, setStageDate] = useState(todayIso());
  const [showJd, setShowJd] = useState(false);

  if (isLoading)
    return (
      <div role="status" aria-label="Loading application" className="max-w-3xl">
        <Skeleton className="mb-6 h-16 w-72" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  if (!app) return <p>Application not found.</p>;

  const save = (patch: Partial<Application>) =>
    update.mutate({ id: app.id, patch });

  const events = [...(app.events ?? [])].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
  const interviews = [...(app.interviews ?? [])].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );

  return (
    <div className="max-w-3xl">
      <Link to="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        ← Back to pipeline
      </Link>

      <header className="mt-3 mb-6 flex items-start justify-between gap-4">
        {/* -ml-1 cancels the edit affordance's own padding so the heading
            starts on the page's left edge like every other page title. */}
        <div className="-ml-1 min-w-0">
          <EditableText
            value={app.company}
            onSave={(v) => save({ company: v })}
            className="page-title"
          />
          <EditableText
            value={app.roleTitle}
            onSave={(v) => save({ roleTitle: v })}
            className="text-[var(--text-muted)]"
          />
        </div>
        <div className="flex flex-col items-end gap-2">
          <StageBadge stage={app.currentStage} />
          <button
            onClick={() => save({ archived: !app.archived })}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {app.archived ? "Unarchive" : "Archive"}
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Details</h3>
          <dl className="space-y-2.5 text-sm">
            <FieldSelect
              label="Source"
              value={app.source}
              options={SOURCES as readonly string[]}
              onSave={(v) => save({ source: v })}
            />
            <FieldUrl
              label="Job posting"
              value={app.jobUrl}
              onSave={(v) => save({ jobUrl: v })}
            />
            <FieldDate
              label="Date applied"
              value={app.dateApplied}
              onSave={(v) => save({ dateApplied: v })}
            />
            <FieldEdit
              label="Location"
              value={app.location ?? ""}
              onSave={(v) => save({ location: v })}
            />
            <FieldSelect
              label="Work mode"
              value={app.workMode}
              options={WORK_MODES}
              labels={WORK_MODE_LABELS}
              onSave={(v) => save({ workMode: v })}
            />
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">
                {app.salaryPeriod === "hour" ? "Rate" : "Salary"}
              </dt>
              <dd className="flex items-center gap-1">
                <NumBox
                  value={app.salaryMin}
                  step={app.salaryPeriod === "hour" ? "0.01" : "1"}
                  onSave={(v) => save({ salaryMin: v })}
                />
                <span className="text-[var(--text-muted)]">–</span>
                <NumBox
                  value={app.salaryMax}
                  step={app.salaryPeriod === "hour" ? "0.01" : "1"}
                  onSave={(v) => save({ salaryMax: v })}
                />
                {/* Right next to the figures, because the same number means
                    very different things under the two periods. */}
                <select
                  value={app.salaryPeriod}
                  onChange={(e) =>
                    save({ salaryPeriod: e.target.value as SalaryPeriod })
                  }
                  className="input-quiet text-xs text-[var(--text-muted)]"
                >
                  {SALARY_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {SALARY_PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-[var(--text-muted)]">Referred by</dt>
              <dd className="min-w-0 flex-1 text-right">
                <ContactPicker
                  className="input-quiet w-full text-right"
                  name={app.contactName ?? ""}
                  contactId={app.contactId ?? ""}
                  onCommit={(name, contactId) =>
                    save({
                      contactName: name.trim() || null,
                      contactId: contactId || null,
                    })
                  }
                />
              </dd>
            </div>
            <FieldOptional
              label="Industry"
              value={app.industry}
              options={INDUSTRIES as readonly string[]}
              onSave={(v) => save({ industry: v })}
            />
            <FieldOptional
              label="Role type"
              value={app.roleType}
              options={ROLE_TYPES as readonly string[]}
              onSave={(v) => save({ roleType: v })}
            />
          </dl>
        </section>

        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Follow-up</h3>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Next action
          </label>
          <input
            defaultValue={app.nextAction ?? ""}
            onBlur={(e) => save({ nextAction: e.target.value })}
            placeholder="e.g. Send thank-you note"
            className="input mb-3 w-full"
          />
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Next action date
          </label>
          <input
            type="date"
            defaultValue={app.nextActionDate ?? ""}
            onChange={(e) => save({ nextActionDate: e.target.value || null })}
            className="input w-full"
          />

          <h3 className="mb-2 mt-5 text-sm font-semibold">Notes</h3>
          <textarea
            defaultValue={app.notes ?? ""}
            onBlur={(e) => save({ notes: e.target.value })}
            rows={4}
            placeholder="Free-text notes…"
            className="input w-full"
          />
        </section>
      </div>

      {/* Evaluation snapshot — read-only, present when this application was
          created by converting a job evaluation. */}
      {app.evaluation && (
        <EvaluationPanel evaluation={app.evaluation} />
      )}

      {/* Job description — paste it in before the posting disappears. */}
      <section className="card mt-4 p-4">
        <button
          onClick={() => setShowJd((s) => !s)}
          title="Archive the posting text — it survives after the listing is taken down"
          className="flex w-full items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold">Job description</h3>
          <span className="text-xs text-[var(--text-muted)]">
            {app.jobDescription
              ? `${app.jobDescription.length.toLocaleString()} chars · ${showJd ? "hide" : "show"}`
              : showJd
                ? "hide"
                : "add"}
          </span>
        </button>
        {showJd && (
          <textarea
            defaultValue={app.jobDescription ?? ""}
            onBlur={(e) => save({ jobDescription: e.target.value || null })}
            rows={10}
            placeholder="Paste the posting text here — postings get taken down fast, and this preserves what you actually applied to."
            className="input mt-3 w-full"
          />
        )}
      </section>

      {/* The two documents that went out, each with its archived text. */}
      <AttachmentSection app={app} kind="resume" />
      <AttachmentSection app={app} kind="cover-letter" />

      {/* Interview rounds — stubs auto-created by interview-type stage events. */}
      <section className="card mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Interviews</h3>
          <button
            onClick={() => addInterview.mutate({ id: app.id, date: todayIso() })}
            title="Add a round manually — interview-type stage events below create one automatically"
            className="btn btn-secondary btn-sm"
          >
            + Add round
          </button>
        </div>
        {interviews.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No rounds yet. Recording a screen/interview stage below creates one
            automatically.
          </p>
        ) : (
          <div className="space-y-3">
            {interviews.map((iv) => (
              <InterviewCard key={iv.id} appId={app.id} interview={iv} />
            ))}
          </div>
        )}
      </section>

      {/* Stage history — the append-only log made visible. */}
      <section className="card mt-4 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Stage history</h3>
          <span className="text-xs text-[var(--text-muted)]">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mb-5 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--surface-2)] p-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Record transition
            </label>
            <select
              value={newStage}
              onChange={(e) => setNewStage(e.target.value as Stage)}
              className="input"
            >
              {ALL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">
              Date
            </label>
            <input
              type="date"
              value={stageDate}
              onChange={(e) => setStageDate(e.target.value)}
              className="input"
            />
          </div>
          <input
            placeholder="Optional note"
            value={stageNote}
            onChange={(e) => setStageNote(e.target.value)}
            className="input flex-1"
          />
          <button
            onClick={() => {
              setStage.mutate({
                id: app.id,
                stage: newStage,
                note: stageNote || undefined,
                occurredAt: isoFromDate(stageDate),
              });
              setStageNote("");
              setStageDate(todayIso());
            }}
            title="Append this transition to the history — it never overwrites"
            className="btn btn-primary btn-lg"
          >
            Add
          </button>
        </div>

        <ol className="relative ml-2 border-l border-[var(--border)]">
          {events.map((e, i) => {
            const next = events[i + 1];
            const durationDays = next
              ? daysBetween(next.occurredAt, e.occurredAt)
              : null;
            return (
              <li key={e.id} className="mb-4 ml-4">
                <span
                  className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-[var(--surface)]"
                  style={{ background: STAGE_COLORS[e.stage] }}
                />
                <div className="flex items-center justify-between">
                  <div className="font-medium">{STAGE_LABELS[e.stage]}</div>
                  <button
                    onClick={() =>
                      delEvent.mutate({ id: app.id, eventId: e.id })
                    }
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
                    title="Delete event"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <input
                    type="date"
                    value={e.occurredAt.slice(0, 10)}
                    onChange={(ev) =>
                      ev.target.value &&
                      updateEvent.mutate({
                        id: app.id,
                        eventId: e.id,
                        occurredAt: isoFromDate(ev.target.value),
                      })
                    }
                    className="input-quiet text-[var(--text-muted)]"
                    title="Edit stage date"
                  />
                  {durationDays !== null && (
                    <span>· {durationDays}d in previous stage</span>
                  )}
                </div>
                {e.note && <div className="mt-0.5 text-sm">{e.note}</div>}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mt-6">
        <button
          onClick={() => {
            if (confirm("Permanently delete this application and its history?")) {
              fetch(`/api/applications/${app.id}`, { method: "DELETE" }).then(
                () => navigate("/"),
              );
            }
          }}
          className="text-xs text-[var(--danger)] hover:underline"
        >
          Delete permanently
        </button>
      </div>
    </div>
  );
}

// Read-only view of a converted job evaluation: composite + verdict, the seven
// dimension scores with notes, any reject-fast flags, and the conclusion.
function EvaluationPanel({ evaluation: e }: { evaluation: EvaluationSnapshot }) {
  const verdict = VERDICTS[e.verdict];
  const setFlags = REJECT_FLAGS.filter((f) => e.flags?.[f.key]);
  return (
    <section className="card mt-4 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Evaluation</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--text-muted)]">
            <span className="text-lg font-bold text-[var(--text)] tabular-nums">
              {e.composite}
            </span>{" "}
            / 100
          </span>
          {verdict && (
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold text-[var(--on-stage)]"
              style={{ background: VERDICT_COLORS[e.verdict] }}
            >
              {verdict.label}
            </span>
          )}
        </div>
      </div>

      <dl className="space-y-2.5">
        {DIMENSIONS.map((d) => {
          const s = e.scores?.[d.key] ?? 0;
          const note = e.notes?.[d.key]?.trim();
          return (
            <div key={d.key}>
              <div className="flex items-center gap-2">
                <dt className="w-52 shrink-0 text-sm text-[var(--text-muted)]">
                  {d.label}{" "}
                  <span className="text-xs">({d.weightPct}%)</span>
                </dt>
                <dd className="flex flex-1 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <span
                      className="block h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${s * 10}%` }}
                    />
                  </span>
                  <span className="w-10 text-right text-sm font-semibold tabular-nums">
                    {s}/10
                  </span>
                </dd>
              </div>
              {note && (
                <p className="ml-2 mt-0.5 text-sm text-[var(--text-muted)]">
                  {note}
                </p>
              )}
            </div>
          );
        })}
      </dl>

      {setFlags.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">
            Reject-fast flags
          </div>
          <ul className="space-y-1">
            {setFlags.map((f) => (
              <li key={f.key} className="text-sm text-[var(--stage-rejected)]">
                ⚠ {f.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.conclusion?.trim() && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">
            Conclusion
          </div>
          <p className="whitespace-pre-wrap text-sm">{e.conclusion.trim()}</p>
        </div>
      )}
    </section>
  );
}

// One interview round: date + format on the first line, then interviewers and
// one notes field — questions asked, prep and retro together, because that is
// how a conversation gets written down. All inline-editable.
function InterviewCard({
  appId,
  interview: iv,
}: {
  appId: string;
  interview: Interview;
}) {
  const updateInterview = useUpdateInterview();
  const deleteInterview = useDeleteInterview();
  const patch = (p: Record<string, unknown>) =>
    updateInterview.mutate({ id: appId, interviewId: iv.id, patch: p });

  const inputCls =
    "input-quiet";

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="date"
          defaultValue={iv.date ?? ""}
          onChange={(e) => e.target.value && patch({ date: e.target.value })}
          className={inputCls}
          title="Interview date"
        />
        <select
          value={iv.format ?? ""}
          onChange={(e) => patch({ format: e.target.value || null })}
          className={`${inputCls} text-[var(--text-muted)]`}
          title="Format"
        >
          <option value="">format…</option>
          {INTERVIEW_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {iv.date && (
          <span className="text-xs text-[var(--text-muted)]">
            {fmtDate(iv.date)}
          </span>
        )}
        <button
          onClick={() =>
            deleteInterview.mutate({ id: appId, interviewId: iv.id })
          }
          className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
          title="Delete round"
        >
          ✕
        </button>
      </div>
      <input
        defaultValue={iv.interviewers ?? ""}
        onBlur={(e) =>
          e.target.value !== (iv.interviewers ?? "") &&
          patch({ interviewers: e.target.value || null })
        }
        placeholder="Interviewers (names, roles)…"
        className={`mb-2 w-full text-sm ${inputCls}`}
      />
      <textarea
        defaultValue={iv.notes ?? ""}
        onBlur={(e) =>
          e.target.value !== (iv.notes ?? "") &&
          patch({ notes: e.target.value || null })
        }
        rows={4}
        placeholder="Questions asked, prep, retro — what came up, what went well, what to improve…"
        className={`w-full text-sm ${inputCls}`}
      />
    </div>
  );
}
