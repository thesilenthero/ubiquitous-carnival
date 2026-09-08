import { useEffect, useState } from "react";
import { useCreateApplication, useUploadAttachment } from "../api";
import {
  DEFAULT_SALARY_PERIOD,
  DEFAULT_SOURCE,
  DEFAULT_WORK_MODE,
  INDUSTRIES,
  ROLE_TYPES,
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  SOURCES,
  WORK_MODES,
  WORK_MODE_LABELS,
  classifyRoleType,
} from "../types";
import type { FetchedPosting, SalaryPeriod, WorkMode } from "../types";
import { AutofillPosting } from "./AutofillPosting";
import { ContactPicker } from "./ContactPicker";
import { todayIso } from "../lib/format";

const inputCls = "input w-full";
const labelCls = "mb-1 block text-xs font-medium text-[var(--text-muted)]";

// One short form to add an application. Only company + role are required, so the
// common case is: type two fields, hit Enter, done — faster than a spreadsheet row.
export function NewApplicationModal({ onClose }: { onClose: () => void }) {
  const create = useCreateApplication();
  const uploadResume = useUploadAttachment("resume");
  const uploadCoverLetter = useUploadAttachment("cover-letter");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Applied by default. "On the docket" seeds an `interested` event instead, so
  // the row is tracked without claiming anything was sent.
  const [onDocket, setOnDocket] = useState(false);
  // Escape closes, the same as clicking the scrim.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [form, setForm] = useState({
    company: "",
    roleTitle: "",
    source: DEFAULT_SOURCE as string,
    dateApplied: todayIso(),
    // Where you actually search. Autofill overwrites it whenever a posting
    // states its own location, so this only stands for hand-entered rows.
    location: "Toronto",
    workMode: DEFAULT_WORK_MODE as WorkMode,
    salaryMin: "",
    salaryMax: "",
    salaryPeriod: DEFAULT_SALARY_PERIOD as SalaryPeriod,
    contactName: "",
    contactId: "",
    industry: "",
    roleType: "",
    jobUrl: "",
    jobDescription: "",
    resumeText: "",
    notes: "",
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const hourly = form.salaryPeriod === "hour";

  // Merge an autofill result in. Only fields the posting actually established
  // are written — anything the board left blank keeps whatever is in the form,
  // so re-running autofill never wipes a hand-typed value.
  function applyParsed({ fields, jobDescription }: FetchedPosting, url: string | null) {
    setForm((f) => {
      const next = { ...f };
      if (fields.company) next.company = fields.company;
      if (fields.roleTitle) next.roleTitle = fields.roleTitle;
      if (fields.location) next.location = fields.location;
      if (fields.workMode) next.workMode = fields.workMode;
      if (fields.salaryMin !== null) next.salaryMin = String(fields.salaryMin);
      if (fields.salaryMax !== null) next.salaryMax = String(fields.salaryMax);
      if (fields.salaryPeriod) next.salaryPeriod = fields.salaryPeriod;
      if (fields.roleType) next.roleType = fields.roleType;
      if (jobDescription) next.jobDescription = jobDescription;
      if (url) next.jobUrl = url;
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim() || !form.roleTitle.trim()) return;
    setUploadError(null);
    const created = await create.mutateAsync({
      ...form,
      salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
      contactName: form.contactName.trim() || null,
      // Empty means the referrer isn't one of your contacts (or there is no
      // referrer) — send null rather than "", which is not a valid id.
      contactId: form.contactId || null,
      industry: form.industry || null,
      roleType: form.roleType || null,
      jobUrl: form.jobUrl.trim() || null,
      jobDescription: form.jobDescription.trim() || null,
      resumeText: form.resumeText.trim() || null,
      initialStage: onDocket ? "interested" : "applied",
      // Give a docketed role an action so it surfaces in the dated Follow-ups
      // groups rather than sitting in a list nobody opens.
      nextAction: onDocket ? "Submit application" : null,
    } as never);

    // The uploads need an id, so they can only happen after the create. If one
    // fails, the application still exists — say which document it was and leave
    // the modal open rather than silently dropping either the record or the file.
    if (created?.id) {
      const pending: [string, File, typeof uploadResume][] = [];
      if (resumeFile) pending.push(["resume", resumeFile, uploadResume]);
      if (coverLetterFile)
        pending.push(["cover letter", coverLetterFile, uploadCoverLetter]);
      for (const [label, file, mutation] of pending) {
        try {
          await mutation.mutateAsync({ id: created.id, file });
        } catch (err) {
          setUploadError(`the ${label} didn't attach: ${(err as Error).message}`);
          return;
        }
      }
    }
    onClose();
  }

  return (
    <div
      className="animate-scrim fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 pt-[6vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={onDocket ? "Add to docket" : "New application"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="animate-panel card w-full max-w-lg rounded-[var(--radius-xl)] p-5 shadow-[var(--shadow-lg)]"
      >
        <h2 className="mb-4 text-base font-semibold tracking-tight">
          {onDocket ? "Add to docket" : "New application"}
        </h2>

        <label
          className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)]"
          title="Track a role you want but haven't applied to yet. It stays out of the funnel and out of analytics until you mark it applied."
        >
          <input
            type="checkbox"
            checked={onDocket}
            onChange={(e) => setOnDocket(e.target.checked)}
          />
          Haven't applied yet — put it on the docket
        </label>

        <AutofillPosting className="mb-4" onResult={applyParsed} />

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Company *</label>
            <input
              autoFocus
              className={inputCls}
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              placeholder="Stripe"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Role title *</label>
            <input
              className={inputCls}
              value={form.roleTitle}
              onChange={(e) => set("roleTitle", e.target.value)}
              onBlur={(e) => {
                // Auto-suggest role type from the title if not set yet.
                if (!form.roleType && e.target.value.trim())
                  set("roleType", classifyRoleType(e.target.value));
              }}
              placeholder="Data Analyst"
            />
          </div>
          <div>
            <label className={labelCls}>Source</label>
            <select
              className={inputCls}
              value={form.source}
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
            <label className={labelCls}>
              {onDocket ? "Date added" : "Date applied"}
            </label>
            <input
              type="date"
              className={inputCls}
              value={form.dateApplied}
              onChange={(e) => set("dateApplied", e.target.value)}
              title={
                onDocket
                  ? "A placeholder while the role is on the docket — the real date applied is recorded when you mark it applied"
                  : undefined
              }
            />
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input
              className={inputCls}
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Remote / NYC"
            />
          </div>
          <div>
            <label className={labelCls}>Work mode</label>
            <select
              className={inputCls}
              value={form.workMode}
              onChange={(e) => set("workMode", e.target.value as WorkMode)}
            >
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {WORK_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pay</label>
            <select
              className={inputCls}
              value={form.salaryPeriod}
              onChange={(e) =>
                set("salaryPeriod", e.target.value as SalaryPeriod)
              }
            >
              {SALARY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {SALARY_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              {hourly ? "Rate min" : "Salary min"}
            </label>
            <input
              type="number"
              // Contract rates come with cents; annual salaries don't.
              step={hourly ? "0.01" : "1"}
              className={inputCls}
              value={form.salaryMin}
              onChange={(e) => set("salaryMin", e.target.value)}
              placeholder={hourly ? "60" : "120000"}
            />
          </div>
          <div>
            <label className={labelCls}>
              {hourly ? "Rate max" : "Salary max"}
            </label>
            <input
              type="number"
              step={hourly ? "0.01" : "1"}
              className={inputCls}
              value={form.salaryMax}
              onChange={(e) => set("salaryMax", e.target.value)}
              placeholder={hourly ? "75" : "150000"}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Referred by</label>
            <ContactPicker
              className={inputCls}
              name={form.contactName}
              contactId={form.contactId}
              onChange={(name, contactId) =>
                setForm((f) => ({ ...f, contactName: name, contactId }))
              }
            />
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <select
              className={inputCls}
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
            >
              <option value="">—</option>
              {INDUSTRIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Role type</label>
            <select
              className={inputCls}
              value={form.roleType}
              onChange={(e) => set("roleType", e.target.value)}
            >
              <option value="">—</option>
              {ROLE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Job posting URL</label>
            <input
              type="url"
              className={inputCls}
              value={form.jobUrl}
              onChange={(e) => set("jobUrl", e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Job description</label>
            <textarea
              className={inputCls}
              rows={3}
              value={form.jobDescription}
              onChange={(e) => set("jobDescription", e.target.value)}
              placeholder="Paste the posting text — it preserves the JD after the listing disappears"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Resume (PDF)</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--text)]"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {resumeFile
                ? `${resumeFile.name} · attaches after the application is created`
                : "The text is extracted automatically for search and CSV export."}
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Cover letter (PDF)</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setCoverLetterFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--border)] file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--text)]"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {coverLetterFile
                ? `${coverLetterFile.name} · attaches after the application is created`
                : "The text is extracted automatically and kept with the application."}
            </p>
          </div>
          {uploadError && (
            <div className="col-span-2">
              <p className="text-xs text-[var(--stage-rejected)]">
                Application created, but {uploadError}
              </p>
            </div>
          )}
          <div className="col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>

        {create.isError && (
          <p className="mt-3 text-sm text-[var(--danger)]">
            {(create.error as Error).message}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              create.isPending ||
              !form.company.trim() ||
              !form.roleTitle.trim()
            }
            className="btn btn-primary btn-lg"
          >
            {create.isPending ? "Adding…" : "Add application"}
          </button>
        </div>
      </form>
    </div>
  );
}
