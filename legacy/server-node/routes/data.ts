import { Router } from "express";
import { computeAnalytics } from "../analytics.js";
import { exportCsv, parseCsv } from "../csv.js";
import { createApplication, type NewApplicationInput } from "../repo.js";
import { getSettings, updateSettings } from "../settings.js";
import { isStage, isIsoDate, type Stage } from "../domain.js";

export const dataRouter = Router();

// Live analytics — recomputed from the event log on every request. Accepts an
// optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window on date applied.
dataRouter.get("/analytics", (req, res) => {
  const range: { from?: string; to?: string } = {};
  for (const key of ["from", "to"] as const) {
    const v = req.query[key];
    if (v === undefined) continue;
    if (!isIsoDate(v)) {
      return res.status(400).json({ error: `invalid ${key} date: ${v}` });
    }
    range[key] = v;
  }
  res.json(computeAnalytics(range));
});

dataRouter.get("/settings", (_req, res) => {
  res.json(getSettings());
});

dataRouter.patch("/settings", (req, res) => {
  const b = req.body ?? {};
  if (b.weeklyTarget !== undefined) {
    const n = Number(b.weeklyTarget);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      return res
        .status(400)
        .json({ error: "weeklyTarget must be a number between 1 and 200" });
    }
    b.weeklyTarget = n;
  }
  res.json(updateSettings(b));
});

// Full CSV export: escape hatch against lock-in and migration safety net.
dataRouter.get("/export.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="job-applications-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
  );
  res.send(exportCsv());
});

// Migration import. Expects { csv: string, mapping: { <schemaField>: <header> } }.
// For historical rows only the current stage is known, so we seed the event log
// with a single event at the applied date (timing of intermediate stages is
// unknown — a documented caveat of the migration).
dataRouter.post("/import", (req, res) => {
  const { csv, mapping } = req.body ?? {};
  if (typeof csv !== "string" || !mapping || typeof mapping !== "object") {
    return res.status(400).json({ error: "csv and mapping are required" });
  }
  const rows = parseCsv(csv);
  if (rows.length < 2) return res.json({ imported: 0, errors: [] });

  const header = rows[0].map((h) => h.trim());
  const idx = (field: string): number => {
    const col = mapping[field];
    return col ? header.indexOf(col) : -1;
  };
  const cell = (row: string[], field: string): string | undefined => {
    const i = idx(field);
    return i >= 0 ? row[i]?.trim() : undefined;
  };

  let imported = 0;
  const errors: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const company = cell(row, "company");
    const roleTitle = cell(row, "roleTitle");
    if (!company || !roleTitle) {
      errors.push(`Row ${r + 1}: missing company or role title`);
      continue;
    }
    const source = cell(row, "source") || "other";
    const rawStage = cell(row, "currentStage");
    const stage: Stage = isStage(rawStage) ? rawStage : "applied";
    const dateApplied =
      cell(row, "dateApplied") || new Date().toISOString().slice(0, 10);

    const input: NewApplicationInput = {
      company,
      roleTitle,
      source,
      dateApplied,
      location: cell(row, "location") || null,
      salaryMin: toNum(cell(row, "salaryMin")),
      salaryMax: toNum(cell(row, "salaryMax")),
      contactName: cell(row, "contactName") || null,
      referralSource: cell(row, "referralSource") || null,
      notes: cell(row, "notes") || null,
      initialStage: stage,
      initialStageAt: new Date(dateApplied + "T00:00:00.000Z").toISOString(),
    };
    try {
      createApplication(input);
      imported++;
    } catch (e) {
      errors.push(`Row ${r + 1}: ${(e as Error).message}`);
    }
  }
  res.json({ imported, errors });
});

function toNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
