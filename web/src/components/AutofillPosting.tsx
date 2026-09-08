import { useState } from "react";
import { useFetchPosting } from "../api";
import { ATS_SOURCES, type FetchedPosting } from "../types";

const inputCls =
  "input w-full";

const SOURCE_LABELS: Record<FetchedPosting["source"], string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  html: "the page",
  pasted: "your paste",
};

// Fill the form from a job posting instead of typing it.
//
// Greenhouse, Lever, Ashby, and SmartRecruiters URLs are read through those
// boards' public JSON APIs — exact fields, no scraping, no API key, no cost.
// Any other URL yields the description text only; so does pasting. There is no
// model behind this, so nothing is inferred from prose — a field the board
// doesn't state stays blank rather than being guessed.
export function AutofillPosting({
  onResult,
  className,
}: {
  /** `url` is the posting URL that was read, or null when text was pasted. */
  onResult: (result: FetchedPosting, url: string | null) => void;
  className?: string;
}) {
  const fetchPosting = useFetchPosting();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const value = mode === "url" ? url : text;

  async function run() {
    if (!value.trim() || fetchPosting.isPending) return;
    setNote(null);
    fetchPosting.reset();
    const usedUrl = mode === "url" ? url.trim() : null;
    let result: FetchedPosting;
    try {
      result = await fetchPosting.mutateAsync(
        usedUrl ? { url: usedUrl } : { text: text.trim() },
      );
    } catch {
      return; // the isError branch below renders the message
    }
    onResult(result, usedUrl);

    const filled = Object.values(result.fields).filter((v) => v !== null).length;
    const where = SOURCE_LABELS[result.source];
    setNote(
      ATS_SOURCES.includes(result.source)
        ? `Filled ${filled} field${filled === 1 ? "" : "s"} from ${where}. Check them before saving.`
        : `Saved the description from ${where}. This board doesn't publish structured fields, so the rest is yours to fill in.`,
    );
  }

  return (
    <div
      className={`rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 ${className ?? ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Autofill from a posting</span>
        <div className="flex gap-1 text-xs">
          {(["url", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setNote(null);
                fetchPosting.reset();
              }}
              className={`rounded px-2 py-0.5 ${
                mode === m
                  ? "bg-[var(--accent-fill)] font-medium text-[var(--on-accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {m === "url" ? "URL" : "Paste"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        {mode === "url" ? (
          <input
            type="url"
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // Enter would otherwise submit the surrounding form.
              if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
            placeholder="https://job-boards.greenhouse.io/…"
          />
        ) : (
          <textarea
            className={inputCls}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the posting text. This saves the description only — pasted text can't fill the other fields."
          />
        )}
        <button
          type="button"
          onClick={() => void run()}
          disabled={!value.trim() || fetchPosting.isPending}
          className="btn btn-primary shrink-0"
        >
          {fetchPosting.isPending ? "Reading…" : "Autofill"}
        </button>
      </div>

      {fetchPosting.isError ? (
        <p className="mt-2 text-xs text-[var(--stage-rejected)]">
          {(fetchPosting.error as Error).message}
        </p>
      ) : note ? (
        <p className="mt-2 text-xs text-[var(--text-muted)]">{note}</p>
      ) : (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Workday, Greenhouse, Lever, Ashby, and SmartRecruiters links fill the
          fields directly. Other links save just the description.
        </p>
      )}
    </div>
  );
}
