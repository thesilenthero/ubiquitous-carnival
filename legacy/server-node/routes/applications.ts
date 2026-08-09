import { Router } from "express";
import {
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
  addStageEvent,
  updateStageEvent,
  deleteStageEvent,
  deleteApplication,
  addInterview,
  updateInterview,
  deleteInterview,
  type NewApplicationInput,
} from "../repo.js";
import { isStage, isIsoDate, isIsoTimestamp } from "../domain.js";

export const applicationsRouter = Router();

applicationsRouter.get("/", (_req, res) => {
  res.json(listApplications());
});

applicationsRouter.get("/:id", (req, res) => {
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Not found" });
  res.json(app);
});

applicationsRouter.post("/", (req, res) => {
  const b = req.body ?? {};
  if (!b.company || !b.roleTitle) {
    return res
      .status(400)
      .json({ error: "company and roleTitle are required" });
  }
  if (b.source !== undefined && !isNonEmptyString(b.source)) {
    return res.status(400).json({ error: "source must be a non-empty string" });
  }
  if (b.dateApplied && !isIsoDate(b.dateApplied)) {
    return res
      .status(400)
      .json({ error: `invalid dateApplied: ${b.dateApplied}` });
  }
  if (b.nextActionDate && !isIsoDate(b.nextActionDate)) {
    return res
      .status(400)
      .json({ error: `invalid nextActionDate: ${b.nextActionDate}` });
  }
  const input: NewApplicationInput = {
    company: String(b.company),
    roleTitle: String(b.roleTitle),
    source: b.source,
    dateApplied: b.dateApplied || new Date().toISOString().slice(0, 10),
    location: b.location ?? null,
    remote: !!b.remote,
    salaryMin: numOrNull(b.salaryMin),
    salaryMax: numOrNull(b.salaryMax),
    contactName: b.contactName ?? null,
    referralSource: b.referralSource ?? null,
    industry: b.industry ?? null,
    roleType: b.roleType ?? null,
    jobUrl: b.jobUrl ?? null,
    jobDescription: b.jobDescription ?? null,
    resumeText: b.resumeText ?? null,
    notes: b.notes ?? null,
    nextAction: b.nextAction ?? null,
    nextActionDate: b.nextActionDate ?? null,
  };
  res.status(201).json(createApplication(input));
});

applicationsRouter.patch("/:id", (req, res) => {
  const b = req.body ?? {};
  if (b.source !== undefined && !isNonEmptyString(b.source)) {
    return res.status(400).json({ error: "source must be a non-empty string" });
  }
  if (b.dateApplied !== undefined && !isIsoDate(b.dateApplied)) {
    return res
      .status(400)
      .json({ error: `invalid dateApplied: ${b.dateApplied}` });
  }
  if (
    "nextActionDate" in b &&
    b.nextActionDate != null &&
    !isIsoDate(b.nextActionDate)
  ) {
    return res
      .status(400)
      .json({ error: `invalid nextActionDate: ${b.nextActionDate}` });
  }
  if ("salaryMin" in b) b.salaryMin = numOrNull(b.salaryMin);
  if ("salaryMax" in b) b.salaryMax = numOrNull(b.salaryMax);
  const updated = updateApplication(req.params.id, b);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// Record a stage transition (append to the log — never an overwrite).
applicationsRouter.post("/:id/stage", (req, res) => {
  const { stage, note, occurredAt } = req.body ?? {};
  if (!isStage(stage)) {
    return res.status(400).json({ error: `invalid stage: ${stage}` });
  }
  if (occurredAt !== undefined && !isIsoTimestamp(occurredAt)) {
    return res.status(400).json({ error: `invalid occurredAt: ${occurredAt}` });
  }
  const updated = addStageEvent(req.params.id, stage, note, occurredAt);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// Edit an existing stage event (correct its date/stage/note).
applicationsRouter.patch("/:id/stage/:eventId", (req, res) => {
  const { stage, note, occurredAt } = req.body ?? {};
  if (stage !== undefined && !isStage(stage)) {
    return res.status(400).json({ error: `invalid stage: ${stage}` });
  }
  if (occurredAt !== undefined && !isIsoTimestamp(occurredAt)) {
    return res.status(400).json({ error: `invalid occurredAt: ${occurredAt}` });
  }
  const updated = updateStageEvent(req.params.id, req.params.eventId, {
    stage,
    note,
    occurredAt,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

applicationsRouter.delete("/:id/stage/:eventId", (req, res) => {
  const updated = deleteStageEvent(req.params.id, req.params.eventId);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// Interview rounds. Stubs are auto-created when an interview-type stage event
// is recorded; these routes add extra rounds and fill in / correct records.
applicationsRouter.post("/:id/interviews", (req, res) => {
  const b = req.body ?? {};
  if (b.date != null && !isIsoDate(b.date)) {
    return res.status(400).json({ error: `invalid date: ${b.date}` });
  }
  const updated = addInterview(req.params.id, {
    date: b.date,
    format: b.format,
    interviewers: b.interviewers,
    questions: b.questions,
    notes: b.notes,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.status(201).json(updated);
});

applicationsRouter.patch("/:id/interviews/:interviewId", (req, res) => {
  const b = req.body ?? {};
  if ("date" in b && b.date != null && !isIsoDate(b.date)) {
    return res.status(400).json({ error: `invalid date: ${b.date}` });
  }
  const updated = updateInterview(req.params.id, req.params.interviewId, b);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

applicationsRouter.delete("/:id/interviews/:interviewId", (req, res) => {
  const updated = deleteInterview(req.params.id, req.params.interviewId);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

// Hard delete is intentionally available but the UI defaults to archiving.
applicationsRouter.delete("/:id", (req, res) => {
  const ok = deleteApplication(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}
