import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useApplication,
  useAddInterview,
  useDeleteInterview,
  useDeleteResume,
  useDeleteStageEvent,
  useSetStage,
  useUpdateApplication,
  useUpdateInterview,
  useUpdateStageEvent,
  useUploadResume,
} from "../api";
import {
  ALL_STAGES,
  INDUSTRIES,
  INTERVIEW_FORMATS,
  ROLE_TYPES,
  SOURCES,
  STAGE_COLORS,
  STAGE_LABELS,
  type Application,
  type Interview,
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
import { daysBetween, fmtBytes, fmtDate } from "../lib/format";
import {
  DIMENSIONS,
  REJECT_FLAGS,
  VERDICTS,
  VERDICT_COLORS,
  type Evaluation as EvaluationSnapshot,
} from "../lib/evaluation";

// User-entered dates are stored at noon UTC so the calendar day never shifts
// when displayed in a negative-offset timezone.
const isoFromDate = (d: string) => new Date(d + "T12:00:00.000Z").toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);

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
  const [stageDate, setStageDate] = useState(todayStr());
  const [showJd, setShowJd] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const upload = useUploadResume();
  const removeResume = useDeleteResume();

  function onPickResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires a change.
    e.target.value = "";
    if (!file || !app) return;
    upload.mutate({ id: app.id, file });
  }

  if (isLoading) return <p className="text-[var(--text-muted)]">Loading…</p>;
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
        <div className="min-w-0">
          <EditableText
            value={app.company}
            onSave={(v) => save({ company: v })}
            className="text-2xl font-bold tracking-tight"
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
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">Remote</dt>
              <dd>
                <input
                  type="checkbox"
                  checked={app.remote}
                  onChange={(e) => save({ remote: e.target.checked })}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-muted)]">Salary</dt>
              <dd className="flex items-center gap-1">
                <NumBox
                  value={app.salaryMin}
                  onSave={(v) => save({ salaryMin: v })}
                />
                <span className="text-[var(--text-muted)]">–</span>
                <NumBox
                  value={app.salaryMax}
                  onSave={(v) => save({ salaryMax: v })}
                />
              </dd>
            </div>
            <FieldEdit
              label="Contact"
              value={app.contactName ?? ""}
              onSave={(v) => save({ contactName: v })}
            />
            <FieldEdit
              label="Referral source"
              value={app.referralSource ?? ""}
              onSave={(v) => save({ referralSource: v })}
            />
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
            className="mb-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <label className="mb-1 block text-xs text-[var(--text-muted)]">
            Next action date
          </label>
          <input
            type="date"
            defaultValue={app.nextActionDate ?? ""}
            onChange={(e) => save({ nextActionDate: e.target.value || null })}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          <h3 className="mb-2 mt-5 text-sm font-semibold">Notes</h3>
          <textarea
            defaultValue={app.notes ?? ""}
            onBlur={(e) => save({ notes: e.target.value })}
            rows={4}
            placeholder="Free-text notes…"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
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
            className="mt-3 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        )}
      </section>

      {/* Resume — the exact PDF that went out, plus its text for search/export. */}
      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Resume</h3>
          {app.resumeFilename ? (
            <div className="flex items-center gap-2">
              <a
                href={`/api/applications/${app.id}/resume`}
                download
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
                title="Download the PDF you attached"
              >
                ↓ Download
              </a>
              <label
                className="cursor-pointer rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                title="Attach a different PDF in its place"
              >
                {upload.isPending ? "Uploading…" : "Replace"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={onPickResume}
                />
              </label>
            </div>
          ) : (
            <label className="cursor-pointer rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">
              {upload.isPending ? "Uploading…" : "Attach PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onPickResume}
              />
            </label>
          )}
        </div>

        {app.resumeFilename && (
          <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="truncate">{app.resumeFilename}</span>
            <span>·</span>
            <span>{fmtBytes(app.resumeSize)}</span>
            {app.resumeUploadedAt && (
              <>
                <span>·</span>
                <span>attached {fmtDate(app.resumeUploadedAt)}</span>
              </>
            )}
            <button
              onClick={() => {
                if (confirm("Remove the attached PDF? The archived text is kept."))
                  removeResume.mutate(app.id);
              }}
              className="ml-auto shrink-0 text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        )}

        {upload.isError && (
          <p className="mt-2 text-xs text-[var(--stage-rejected)]">
            {(upload.error as Error).message}
          </p>
        )}
        {app.resumeFilename && !app.resumeText && !upload.isPending && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            No text layer found in that PDF, so nothing was archived as text —
            the file itself is stored and downloadable. Paste the text below if
            you want it in the CSV export.
          </p>
        )}

        <button
          onClick={() => setShowResume((s) => !s)}
          title="The resume text, used for search and included in the CSV export"
          className="mt-3 flex w-full items-center justify-between text-left"
        >
          <span className="text-xs font-medium text-[var(--text-muted)]">
            Archived text
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {app.resumeText
              ? `${app.resumeText.length.toLocaleString()} chars · ${showResume ? "hide" : "show"}`
              : showResume
                ? "hide"
                : "add"}
          </span>
        </button>
        {showResume && (
          <textarea
            defaultValue={app.resumeText ?? ""}
            onBlur={(e) => save({ resumeText: e.target.value || null })}
            rows={10}
            placeholder="Extracted automatically when you attach a PDF — or paste it here."
            className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        )}
      </section>

      {/* Interview rounds — stubs auto-created by interview-type stage events. */}
      <section className="card mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Interviews</h3>
          <button
            onClick={() => addInterview.mutate({ id: app.id, date: todayStr() })}
            title="Add a round manually — interview-type stage events below create one automatically"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
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
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <input
            placeholder="Optional note"
            value={stageNote}
            onChange={(e) => setStageNote(e.target.value)}
            className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
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
              setStageDate(todayStr());
            }}
            title="Append this transition to the history — it never overwrites"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
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
                  className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white"
                  style={{ background: STAGE_COLORS[e.stage] }}
                />
                <div className="flex items-center justify-between">
                  <div className="font-medium">{STAGE_LABELS[e.stage]}</div>
                  <button
                    onClick={() =>
                      delEvent.mutate({ id: app.id, eventId: e.id })
                    }
                    className="text-xs text-[var(--text-muted)] hover:text-red-600"
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
                    className="rounded border border-transparent px-1 py-0.5 text-[var(--text-muted)] outline-none hover:border-[var(--border)] focus:border-[var(--accent)]"
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
          className="text-xs text-red-600 hover:underline"
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
              className="rounded-full px-3 py-1 text-xs font-semibold text-white"
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

// One interview round: date + format on the first line, then interviewers,
// questions asked, and retro notes — all inline-editable.
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
    "rounded border border-transparent px-1 py-0.5 outline-none hover:border-[var(--border)] focus:border-[var(--accent)]";

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
          className="ml-auto text-xs text-[var(--text-muted)] hover:text-red-600"
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
        defaultValue={iv.questions ?? ""}
        onBlur={(e) =>
          e.target.value !== (iv.questions ?? "") &&
          patch({ questions: e.target.value || null })
        }
        rows={2}
        placeholder="Questions asked — builds your personal question bank…"
        className={`mb-2 w-full text-sm ${inputCls}`}
      />
      <textarea
        defaultValue={iv.notes ?? ""}
        onBlur={(e) =>
          e.target.value !== (iv.notes ?? "") &&
          patch({ notes: e.target.value || null })
        }
        rows={2}
        placeholder="Prep notes / retro — what went well, what to improve…"
        className={`w-full text-sm ${inputCls}`}
      />
    </div>
  );
}
