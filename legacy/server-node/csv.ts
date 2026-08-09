import { listApplications, getApplication } from "./repo.js";
import { STAGE_LABELS } from "./domain.js";

// --- Export -------------------------------------------------------------

const EXPORT_COLUMNS = [
  "id",
  "company",
  "role_title",
  "source",
  "date_applied",
  "current_stage",
  "stage_changed_at",
  "location",
  "remote",
  "salary_min",
  "salary_max",
  "contact_name",
  "referral_source",
  "industry",
  "role_type",
  "job_url",
  "next_action",
  "next_action_date",
  "archived",
  "notes",
  "job_description",
  "resume_text",
  "stage_history",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv(): string {
  const rows = listApplications();
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const a of rows) {
    const full = getApplication(a.id)!;
    const history = (full.events ?? [])
      .map((e) => `${STAGE_LABELS[e.stage]}@${e.occurredAt}`)
      .join(" | ");
    lines.push(
      [
        a.id,
        a.company,
        a.roleTitle,
        a.source,
        a.dateApplied,
        a.currentStage,
        a.stageChangedAt,
        a.location,
        a.remote ? "yes" : "no",
        a.salaryMin,
        a.salaryMax,
        a.contactName,
        a.referralSource,
        a.industry,
        a.roleType,
        a.jobUrl,
        a.nextAction,
        a.nextActionDate,
        a.archived ? "yes" : "no",
        a.notes,
        full.jobDescription,
        full.resumeText,
        history,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

// --- Import (migration from the old Sheets tracker) ---------------------

// Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes, commas
// and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
