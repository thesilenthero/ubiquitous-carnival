import { nanoid } from "nanoid";
import { db } from "./db.js";
import { INTERVIEW_STAGES, type Stage } from "./domain.js";

export interface StageEvent {
  id: string;
  applicationId: string;
  stage: Stage;
  note: string | null;
  occurredAt: string;
}

export interface Interview {
  id: string;
  applicationId: string;
  stageEventId: string | null;
  date: string | null;
  format: string | null;
  interviewers: string | null;
  questions: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  company: string;
  roleTitle: string;
  source: string;
  dateApplied: string;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  contactName: string | null;
  referralSource: string | null;
  industry: string | null;
  roleType: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  resumeText: string | null;
  notes: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  // Derived:
  currentStage: Stage;
  stageChangedAt: string;
  events?: StageEvent[];
  interviews?: Interview[];
}

type AppRow = {
  id: string;
  company: string;
  role_title: string;
  source: string;
  date_applied: string;
  location: string | null;
  remote: number;
  salary_min: number | null;
  salary_max: number | null;
  contact_name: string | null;
  referral_source: string | null;
  industry: string | null;
  role_type: string | null;
  job_url: string | null;
  job_description: string | null;
  resume_text: string | null;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  application_id: string;
  stage: string;
  note: string | null;
  occurred_at: string;
};

function mapEvent(r: EventRow): StageEvent {
  return {
    id: r.id,
    applicationId: r.application_id,
    stage: r.stage as Stage,
    note: r.note,
    occurredAt: r.occurred_at,
  };
}

// Latest event per application, resolved by occurred_at then id as a stable
// tie-breaker. This is the derivation of "current stage" from the event log.
const latestEventFor = db.prepare<[string], EventRow>(`
  SELECT * FROM stage_events
  WHERE application_id = ?
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1
`);

const eventsFor = db.prepare<[string], EventRow>(`
  SELECT * FROM stage_events WHERE application_id = ?
  ORDER BY occurred_at ASC, id ASC
`);

// Latest event for EVERY application in one query — used by the list path so
// it doesn't degrade into one lookup per row.
const latestEventPerApp = db.prepare<[], EventRow>(`
  SELECT id, application_id, stage, note, occurred_at FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY application_id ORDER BY occurred_at DESC, id DESC
    ) AS rn FROM stage_events
  ) WHERE rn = 1
`);

function mapApp(
  r: AppRow,
  includeEvents = false,
  latestOverride?: EventRow,
): Application {
  const latest = latestOverride ?? latestEventFor.get(r.id);
  const app: Application = {
    id: r.id,
    company: r.company,
    roleTitle: r.role_title,
    source: r.source,
    dateApplied: r.date_applied,
    location: r.location,
    remote: !!r.remote,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    contactName: r.contact_name,
    referralSource: r.referral_source,
    industry: r.industry,
    roleType: r.role_type,
    jobUrl: r.job_url,
    jobDescription: r.job_description,
    resumeText: r.resume_text,
    notes: r.notes,
    nextAction: r.next_action,
    nextActionDate: r.next_action_date,
    archived: !!r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    currentStage: (latest?.stage as Stage) ?? "applied",
    stageChangedAt: latest?.occurred_at ?? r.created_at,
  };
  if (includeEvents) {
    app.events = eventsFor.all(r.id).map(mapEvent);
    app.interviews = interviewsFor.all(r.id).map(mapInterview);
  }
  return app;
}

const selectAll = db.prepare<[], AppRow>(`SELECT * FROM applications`);
const selectById = db.prepare<[string], AppRow>(
  `SELECT * FROM applications WHERE id = ?`,
);

export function listApplications(): Application[] {
  const latestByApp = new Map<string, EventRow>();
  for (const e of latestEventPerApp.all()) latestByApp.set(e.application_id, e);
  return selectAll.all().map((r) => mapApp(r, false, latestByApp.get(r.id)));
}

export function getApplication(id: string): Application | undefined {
  const row = selectById.get(id);
  return row ? mapApp(row, true) : undefined;
}

export interface NewApplicationInput {
  company: string;
  roleTitle: string;
  source?: string;
  dateApplied: string;
  location?: string | null;
  remote?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  contactName?: string | null;
  referralSource?: string | null;
  industry?: string | null;
  roleType?: string | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  resumeText?: string | null;
  notes?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  // Optional explicit starting stage/time (used by migration import).
  initialStage?: Stage;
  initialStageAt?: string;
}

const insertApp = db.prepare(`
  INSERT INTO applications (
    id, company, role_title, source, date_applied, location, remote,
    salary_min, salary_max, contact_name, referral_source, industry, role_type,
    job_url, job_description, resume_text, notes, next_action,
    next_action_date, archived, created_at, updated_at
  ) VALUES (
    @id, @company, @role_title, @source, @date_applied, @location, @remote,
    @salary_min, @salary_max, @contact_name, @referral_source, @industry, @role_type,
    @job_url, @job_description, @resume_text, @notes, @next_action,
    @next_action_date, 0, @created_at, @updated_at
  )
`);

const insertEvent = db.prepare(`
  INSERT INTO stage_events (id, application_id, stage, note, occurred_at)
  VALUES (@id, @application_id, @stage, @note, @occurred_at)
`);

export function createApplication(input: NewApplicationInput): Application {
  const now = new Date().toISOString();
  const id = nanoid();
  const stage: Stage = input.initialStage ?? "applied";
  // Seed the event log at the application date (or an explicit time) so even a
  // brand-new record participates in the funnel from its first stage.
  const stageAt =
    input.initialStageAt ??
    (input.dateApplied
      ? new Date(input.dateApplied + "T00:00:00.000Z").toISOString()
      : now);

  const tx = db.transaction(() => {
    insertApp.run({
      id,
      company: input.company,
      role_title: input.roleTitle,
      source: input.source ?? "other",
      date_applied: input.dateApplied,
      location: input.location ?? null,
      remote: input.remote ? 1 : 0,
      salary_min: input.salaryMin ?? null,
      salary_max: input.salaryMax ?? null,
      contact_name: input.contactName ?? null,
      referral_source: input.referralSource ?? null,
      industry: input.industry ?? null,
      role_type: input.roleType ?? null,
      job_url: input.jobUrl ?? null,
      job_description: input.jobDescription ?? null,
      resume_text: input.resumeText ?? null,
      notes: input.notes ?? null,
      next_action: input.nextAction ?? null,
      next_action_date: input.nextActionDate ?? null,
      created_at: now,
      updated_at: now,
    });
    insertEvent.run({
      id: nanoid(),
      application_id: id,
      stage,
      note: null,
      occurred_at: stageAt,
    });
  });
  tx();
  return getApplication(id)!;
}

// Editable scalar fields (everything except the derived stage and identity).
const EDITABLE: Record<string, string> = {
  company: "company",
  roleTitle: "role_title",
  source: "source",
  dateApplied: "date_applied",
  location: "location",
  remote: "remote",
  salaryMin: "salary_min",
  salaryMax: "salary_max",
  contactName: "contact_name",
  referralSource: "referral_source",
  industry: "industry",
  roleType: "role_type",
  jobUrl: "job_url",
  jobDescription: "job_description",
  resumeText: "resume_text",
  notes: "notes",
  nextAction: "next_action",
  nextActionDate: "next_action_date",
  archived: "archived",
};

export function updateApplication(
  id: string,
  patch: Record<string, unknown>,
): Application | undefined {
  const existing = selectById.get(id);
  if (!existing) return undefined;

  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, col] of Object.entries(EDITABLE)) {
    if (key in patch) {
      let val = patch[key];
      if (key === "remote" || key === "archived") val = val ? 1 : 0;
      sets.push(`${col} = @${col}`);
      params[col] = val ?? null;
    }
  }
  if (sets.length > 0) {
    params.updated_at = new Date().toISOString();
    sets.push("updated_at = @updated_at");
    db.prepare(
      `UPDATE applications SET ${sets.join(", ")} WHERE id = @id`,
    ).run(params);
  }
  return getApplication(id);
}

// Record a stage transition. This APPENDS to the log — it never overwrites.
// Interview-type stages also spawn an interview stub (date prefilled from the
// event) so the round can be annotated without re-entering the basics.
export function addStageEvent(
  applicationId: string,
  stage: Stage,
  note?: string | null,
  occurredAt?: string,
): Application | undefined {
  const existing = selectById.get(applicationId);
  if (!existing) return undefined;
  const eventId = nanoid();
  const at = occurredAt ?? new Date().toISOString();
  const tx = db.transaction(() => {
    insertEvent.run({
      id: eventId,
      application_id: applicationId,
      stage,
      note: note ?? null,
      occurred_at: at,
    });
    if (INTERVIEW_STAGES.includes(stage)) {
      const now = new Date().toISOString();
      insertInterview.run({
        id: nanoid(),
        application_id: applicationId,
        stage_event_id: eventId,
        date: at.slice(0, 10),
        format: null,
        interviewers: null,
        questions: null,
        notes: null,
        created_at: now,
        updated_at: now,
      });
    }
    db.prepare(`UPDATE applications SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      applicationId,
    );
  });
  tx();
  return getApplication(applicationId);
}

// Edit an existing stage event — its date, stage, or note. Used to correct
// history (e.g. fixing an imported date). Changing the date can reorder events
// and thus re-derive the current stage, which is intended.
export function updateStageEvent(
  applicationId: string,
  eventId: string,
  patch: { stage?: Stage; note?: string | null; occurredAt?: string },
): Application | undefined {
  const existing = selectById.get(applicationId);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: eventId, app: applicationId };
  if (patch.stage !== undefined) {
    sets.push("stage = @stage");
    params.stage = patch.stage;
  }
  if (patch.note !== undefined) {
    sets.push("note = @note");
    params.note = patch.note ?? null;
  }
  if (patch.occurredAt !== undefined) {
    sets.push("occurred_at = @occurred_at");
    params.occurred_at = patch.occurredAt;
  }
  if (sets.length > 0) {
    db.prepare(
      `UPDATE stage_events SET ${sets.join(", ")} WHERE id = @id AND application_id = @app`,
    ).run(params);
    db.prepare(`UPDATE applications SET updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      applicationId,
    );
  }
  return getApplication(applicationId);
}

// Delete a single stage event (correcting a mis-click). Guarded so an
// application always retains at least one event. An auto-created interview
// stub goes with it, but only while still empty — filled-in notes survive.
export function deleteStageEvent(
  applicationId: string,
  eventId: string,
): Application | undefined {
  const count = db
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) as n FROM stage_events WHERE application_id = ?`,
    )
    .get(applicationId);
  if (!count || count.n <= 1) return getApplication(applicationId);
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM interviews
       WHERE stage_event_id = ? AND application_id = ?
         AND format IS NULL AND interviewers IS NULL
         AND questions IS NULL AND notes IS NULL`,
    ).run(eventId, applicationId);
    db.prepare(
      `DELETE FROM stage_events WHERE id = ? AND application_id = ?`,
    ).run(eventId, applicationId);
  });
  tx();
  return getApplication(applicationId);
}

export function deleteApplication(id: string): boolean {
  const res = db.prepare(`DELETE FROM applications WHERE id = ?`).run(id);
  return res.changes > 0;
}

// --- Interviews ----------------------------------------------------------

type InterviewRow = {
  id: string;
  application_id: string;
  stage_event_id: string | null;
  date: string | null;
  format: string | null;
  interviewers: string | null;
  questions: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapInterview(r: InterviewRow): Interview {
  return {
    id: r.id,
    applicationId: r.application_id,
    stageEventId: r.stage_event_id,
    date: r.date,
    format: r.format,
    interviewers: r.interviewers,
    questions: r.questions,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const interviewsFor = db.prepare<[string], InterviewRow>(`
  SELECT * FROM interviews WHERE application_id = ?
  ORDER BY date ASC, created_at ASC
`);

const insertInterview = db.prepare(`
  INSERT INTO interviews (
    id, application_id, stage_event_id, date, format, interviewers,
    questions, notes, created_at, updated_at
  ) VALUES (
    @id, @application_id, @stage_event_id, @date, @format, @interviewers,
    @questions, @notes, @created_at, @updated_at
  )
`);

export interface InterviewInput {
  date?: string | null;
  format?: string | null;
  interviewers?: string | null;
  questions?: string | null;
  notes?: string | null;
}

export function addInterview(
  applicationId: string,
  input: InterviewInput,
): Application | undefined {
  const existing = selectById.get(applicationId);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  insertInterview.run({
    id: nanoid(),
    application_id: applicationId,
    stage_event_id: null,
    date: input.date ?? now.slice(0, 10),
    format: input.format ?? null,
    interviewers: input.interviewers ?? null,
    questions: input.questions ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return getApplication(applicationId);
}

const INTERVIEW_EDITABLE: Record<string, string> = {
  date: "date",
  format: "format",
  interviewers: "interviewers",
  questions: "questions",
  notes: "notes",
};

export function updateInterview(
  applicationId: string,
  interviewId: string,
  patch: Record<string, unknown>,
): Application | undefined {
  const existing = selectById.get(applicationId);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: interviewId, app: applicationId };
  for (const [key, col] of Object.entries(INTERVIEW_EDITABLE)) {
    if (key in patch) {
      sets.push(`${col} = @${col}`);
      params[col] = patch[key] ?? null;
    }
  }
  if (sets.length > 0) {
    params.updated_at = new Date().toISOString();
    sets.push("updated_at = @updated_at");
    db.prepare(
      `UPDATE interviews SET ${sets.join(", ")} WHERE id = @id AND application_id = @app`,
    ).run(params);
  }
  return getApplication(applicationId);
}

export function deleteInterview(
  applicationId: string,
  interviewId: string,
): Application | undefined {
  const existing = selectById.get(applicationId);
  if (!existing) return undefined;
  db.prepare(
    `DELETE FROM interviews WHERE id = ? AND application_id = ?`,
  ).run(interviewId, applicationId);
  return getApplication(applicationId);
}
