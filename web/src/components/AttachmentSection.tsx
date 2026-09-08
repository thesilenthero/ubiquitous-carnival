import { useState } from "react";
import {
  useDeleteAttachment,
  useUpdateApplication,
  useUploadAttachment,
  type AttachmentKind,
} from "../api";
import type { Application } from "../types";
import { fmtBytes, fmtDate } from "../lib/format";

// The two attachable documents differ only in wording and which four fields
// they read, so one card serves both. Keyed by the same string the API uses.
const KINDS = {
  resume: {
    title: "Resume",
    filename: "resumeFilename",
    size: "resumeSize",
    uploadedAt: "resumeUploadedAt",
    text: "resumeText",
    textTitle: "The resume text, used for search and included in the CSV export",
    // Only the resume text reaches the CSV export, so only it says so.
    noTextHint: "Paste the text below if you want it in the CSV export.",
  },
  "cover-letter": {
    title: "Cover letter",
    filename: "coverLetterFilename",
    size: "coverLetterSize",
    uploadedAt: "coverLetterUploadedAt",
    text: "coverLetterText",
    textTitle: "The cover letter text, kept even after the file is detached",
    noTextHint: "Paste the text below if you want it kept.",
  },
} as const;

// The exact PDF that went out, plus its text for search and the record.
export function AttachmentSection({
  app,
  kind,
}: {
  app: Application;
  kind: AttachmentKind;
}) {
  const meta = KINDS[kind];
  const update = useUpdateApplication();
  const upload = useUploadAttachment(kind);
  const remove = useDeleteAttachment(kind);
  const [showText, setShowText] = useState(false);

  const filename = app[meta.filename];
  const size = app[meta.size];
  const uploadedAt = app[meta.uploadedAt];
  const text = app[meta.text];

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires a change.
    e.target.value = "";
    if (!file) return;
    upload.mutate({ id: app.id, file });
  }

  // Written out per kind rather than with a computed key so the patch stays a
  // checked Partial<Application> instead of a string-indexed object.
  function saveText(value: string | null) {
    const patch: Partial<Application> =
      kind === "resume" ? { resumeText: value } : { coverLetterText: value };
    update.mutate({ id: app.id, patch });
  }

  return (
    <section className="card mt-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{meta.title}</h3>
        {filename ? (
          <div className="flex items-center gap-2">
            <a
              href={`/api/applications/${app.id}/attachments/${kind}`}
              download
              className="btn btn-secondary btn-sm"
              title="Download the PDF you attached"
            >
              ↓ Download
            </a>
            <label
              className="btn btn-secondary btn-sm cursor-pointer"
              title="Attach a different PDF in its place"
            >
              {upload.isPending ? "Uploading…" : "Replace"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={onPick}
              />
            </label>
          </div>
        ) : (
          <label className="btn btn-primary btn-sm cursor-pointer">
            {upload.isPending ? "Uploading…" : "Attach PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={onPick}
            />
          </label>
        )}
      </div>

      {filename && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="truncate">{filename}</span>
          <span>·</span>
          <span>{fmtBytes(size)}</span>
          {uploadedAt && (
            <>
              <span>·</span>
              <span>attached {fmtDate(uploadedAt)}</span>
            </>
          )}
          <button
            onClick={() => {
              if (confirm("Remove the attached PDF? The archived text is kept."))
                remove.mutate(app.id);
            }}
            className="ml-auto shrink-0 text-xs text-[var(--danger)] hover:underline"
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
      {filename && !text && !upload.isPending && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No text layer found in that PDF, so nothing was archived as text —
          the file itself is stored and downloadable. {meta.noTextHint}
        </p>
      )}

      <button
        onClick={() => setShowText((s) => !s)}
        title={meta.textTitle}
        className="mt-3 flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-medium text-[var(--text-muted)]">
          Archived text
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {text
            ? `${text.length.toLocaleString()} chars · ${showText ? "hide" : "show"}`
            : showText
              ? "hide"
              : "add"}
        </span>
      </button>
      {showText && (
        <textarea
          defaultValue={text ?? ""}
          onBlur={(e) => saveText(e.target.value || null)}
          rows={10}
          placeholder="Extracted automatically when you attach a PDF — or paste it here."
          className="input mt-2 w-full"
        />
      )}
    </section>
  );
}
