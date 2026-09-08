import { useState } from "react";
import { useImportCsv } from "../api";

// Migration surface: import the old Sheets export. The user maps their columns
// to the schema; for historical rows only the current stage is known, so the
// server seeds one stage event at the applied date (intermediate timing unknown).
const TARGET_FIELDS: [string, string, boolean][] = [
  ["company", "Company", true],
  ["roleTitle", "Role title", true],
  ["source", "Source", false],
  ["dateApplied", "Date applied", false],
  ["currentStage", "Current stage", false],
  ["location", "Location", false],
  ["workMode", "Work mode", false],
  ["salaryMin", "Salary min", false],
  ["salaryMax", "Salary max", false],
  ["salaryPeriod", "Salary period", false],
  ["contactName", "Referred by", false],
  ["notes", "Notes", false],
];

function splitHeader(line: string): string[] {
  // Header row is unlikely to contain quoted commas; simple split is enough for
  // detecting column names to map.
  return line.split(",").map((h) => h.replace(/^"|"$/g, "").trim());
}

// Best-effort auto-match a schema field to a header by fuzzy name.
function guess(field: string, headers: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const f = norm(field);
  return (
    headers.find((h) => norm(h) === f) ??
    headers.find((h) => norm(h).includes(f) || f.includes(norm(h))) ??
    ""
  );
}

export function ImportCard() {
  const importCsv = useImportCsv();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(
    null,
  );

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => loadCsv(text));
  }

  function loadCsv(text: string) {
    setCsv(text);
    const firstLine = text.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
    const hs = splitHeader(firstLine);
    setHeaders(hs);
    const auto: Record<string, string> = {};
    for (const [field] of TARGET_FIELDS) {
      const g = guess(field, hs);
      if (g) auto[field] = g;
    }
    setMapping(auto);
    setResult(null);
  }

  async function run() {
    const res = await importCsv.mutateAsync({ csv, mapping });
    setResult(res);
  }

  const ready =
    csv && mapping.company && mapping.roleTitle && headers.length > 0;

  return (
    <section className="card p-5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold">Import / migrate from CSV</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Bring in your existing Sheets tracker. Map columns, then import.
          </p>
        </div>
        <span className="text-[var(--text-muted)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="mb-4 block text-sm"
          />

          {headers.length > 0 && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {TARGET_FIELDS.map(([field, label, required]) => (
                  <label key={field} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-[var(--text-muted)]">
                      {label}
                      {required && <span className="text-[var(--danger)]"> *</span>}
                    </span>
                    <select
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: e.target.value }))
                      }
                      className="input w-40"
                    >
                      <option value="">— none —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={run}
                  disabled={!ready || importCsv.isPending}
                  className="btn btn-primary btn-lg"
                >
                  {importCsv.isPending ? "Importing…" : "Import"}
                </button>
                {!ready && (
                  <span className="text-xs text-[var(--text-muted)]">
                    Map Company and Role title to continue.
                  </span>
                )}
              </div>
            </>
          )}

          {result && (
            <div className="mt-4 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <div className="font-medium text-[var(--stage-offer)]">
                Imported {result.imported} application
                {result.imported === 1 ? "" : "s"}.
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-[var(--danger)]">
                  {result.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {result.errors.length > 8 && (
                    <li>…and {result.errors.length - 8} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
