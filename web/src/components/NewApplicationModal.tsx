import { useState } from "react";
import { useCreateApplication } from "../api";
import { INDUSTRIES, ROLE_TYPES, SOURCES, classifyRoleType } from "../types";
import type { FetchedPosting } from "../types";
import { AutofillPosting } from "./AutofillPosting";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-xs font-medium text-[var(--text-muted)]";

// One short form to add an application. Only company + role are required, so the
// common case is: type two fields, hit Enter, done — faster than a spreadsheet row.
export function NewApplicationModal({ onClose }: { onClose: () => void }) {
  const create = useCreateApplication();
  const [form, setForm] = useState({
    company: "",
    roleTitle: "",
    source: "Indeed",
    dateApplied: new Date().toISOString().slice(0, 10),
    location: "",
    remote: true,
    salaryMin: "",
    salaryMax: "",
    contactName: "",
    referralSource: "",
    industry: "",
    roleType: "",
    jobUrl: "",
    jobDescription: "",
    resumeText: "",
    notes: "",
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  // Merge an autofill result in. Only fields the posting actually established
  // are written — anything the board left blank keeps whatever is in the form,
  // so re-running autofill never wipes a hand-typed value.
  function applyParsed({ fields, jobDescription }: FetchedPosting, url: string | null) {
    setForm((f) => {
      const next = { ...f };
      if (fields.company) next.company = fields.company;
      if (fields.roleTitle) next.roleTitle = fields.roleTitle;
      if (fields.location) next.location = fields.location;
      if (fields.remote !== null) next.remote = fields.remote;
      if (fields.salaryMin !== null) next.salaryMin = String(fields.salaryMin);
      if (fields.salaryMax !== null) next.salaryMax = String(fields.salaryMax);
      if (fields.roleType) next.roleType = fields.roleType;
      if (jobDescription) next.jobDescription = jobDescription;
      if (url) next.jobUrl = url;
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company.trim() || !form.roleTitle.trim()) return;
    await create.mutateAsync({
      ...form,
      salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
      industry: form.industry || null,
      roleType: form.roleType || null,
      jobUrl: form.jobUrl.trim() || null,
      jobDescription: form.jobDescription.trim() || null,
      resumeText: form.resumeText.trim() || null,
    } as never);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg p-5 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold">New application</h2>

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
            <label className={labelCls}>Date applied</label>
            <input
              type="date"
              className={inputCls}
              value={form.dateApplied}
              onChange={(e) => set("dateApplied", e.target.value)}
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
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.remote}
                onChange={(e) => set("remote", e.target.checked)}
              />
              Remote
            </label>
          </div>
          <div>
            <label className={labelCls}>Salary min</label>
            <input
              type="number"
              className={inputCls}
              value={form.salaryMin}
              onChange={(e) => set("salaryMin", e.target.value)}
              placeholder="120000"
            />
          </div>
          <div>
            <label className={labelCls}>Salary max</label>
            <input
              type="number"
              className={inputCls}
              value={form.salaryMax}
              onChange={(e) => set("salaryMax", e.target.value)}
              placeholder="150000"
            />
          </div>
          <div>
            <label className={labelCls}>Contact name</label>
            <input
              className={inputCls}
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Referral source</label>
            <input
              className={inputCls}
              value={form.referralSource}
              onChange={(e) => set("referralSource", e.target.value)}
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
            <label className={labelCls}>Resume</label>
            <textarea
              className={inputCls}
              rows={3}
              value={form.resumeText}
              onChange={(e) => set("resumeText", e.target.value)}
              placeholder="Paste the resume text you sent with this application"
            />
          </div>
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
          <p className="mt-3 text-sm text-red-600">
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
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {create.isPending ? "Adding…" : "Add application"}
          </button>
        </div>
      </form>
    </div>
  );
}
