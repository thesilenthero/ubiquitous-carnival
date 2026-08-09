import { nanoid } from "nanoid";
import { db } from "./db.js";
import { addStageEvent } from "./repo.js";
import { type Stage } from "./domain.js";

// Suggest-only inbox for stage changes detected outside the app — e.g. Claude
// scanning Gmail for rejection/interview emails and POSTing what it finds.
// Nothing touches the event log until a suggestion is accepted in the UI.

export interface Suggestion {
  id: string;
  applicationId: string;
  suggestedStage: Stage;
  evidence: string | null;
  source: string;
  status: "pending" | "accepted" | "dismissed";
  occurredAt: string | null;
  createdAt: string;
  // Joined for display:
  company: string;
  roleTitle: string;
  currentStage?: Stage;
}

type SuggestionRow = {
  id: string;
  application_id: string;
  suggested_stage: string;
  evidence: string | null;
  source: string;
  status: string;
  occurred_at: string | null;
  created_at: string;
  company: string;
  role_title: string;
};

function mapSuggestion(r: SuggestionRow): Suggestion {
  return {
    id: r.id,
    applicationId: r.application_id,
    suggestedStage: r.suggested_stage as Stage,
    evidence: r.evidence,
    source: r.source,
    status: r.status as Suggestion["status"],
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    company: r.company,
    roleTitle: r.role_title,
  };
}

const selectPending = db.prepare<[], SuggestionRow>(`
  SELECT s.*, a.company, a.role_title
  FROM suggestions s JOIN applications a ON a.id = s.application_id
  WHERE s.status = 'pending'
  ORDER BY s.created_at DESC
`);

const selectSuggestion = db.prepare<[string], SuggestionRow>(`
  SELECT s.*, a.company, a.role_title
  FROM suggestions s JOIN applications a ON a.id = s.application_id
  WHERE s.id = ?
`);

export function listPendingSuggestions(): Suggestion[] {
  return selectPending.all().map(mapSuggestion);
}

export interface SuggestionInput {
  applicationId: string;
  suggestedStage: Stage;
  evidence?: string | null;
  source?: string;
  occurredAt?: string | null;
}

export function createSuggestion(
  input: SuggestionInput,
): Suggestion | "already-recorded" | undefined {
  const app = db
    .prepare<[string], { id: string }>(`SELECT id FROM applications WHERE id = ?`)
    .get(input.applicationId);
  if (!app) return undefined;
  // A stage the log already contains needs no suggestion — this keeps scans
  // over historical email from re-suggesting every known outcome.
  const already = db
    .prepare<[string, string], { id: string }>(
      `SELECT id FROM stage_events WHERE application_id = ? AND stage = ?`,
    )
    .get(input.applicationId, input.suggestedStage);
  if (already) return "already-recorded";
  // Skip exact duplicates still awaiting review, so a re-scan is idempotent.
  const dup = db
    .prepare<[string, string], { id: string }>(
      `SELECT id FROM suggestions
       WHERE application_id = ? AND suggested_stage = ? AND status = 'pending'`,
    )
    .get(input.applicationId, input.suggestedStage);
  const id = dup?.id ?? nanoid();
  if (!dup) {
    db.prepare(
      `INSERT INTO suggestions
       (id, application_id, suggested_stage, evidence, source, status, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      input.applicationId,
      input.suggestedStage,
      input.evidence ?? null,
      input.source ?? "email",
      input.occurredAt ?? null,
      new Date().toISOString(),
    );
  }
  const row = selectSuggestion.get(id);
  return row ? mapSuggestion(row) : undefined;
}

// Accepting appends the suggested stage event (dated when the evidence
// happened, if known) and closes the suggestion — atomically.
export function acceptSuggestion(id: string): Suggestion | undefined {
  const row = selectSuggestion.get(id);
  if (!row || row.status !== "pending") return row ? mapSuggestion(row) : undefined;
  const tx = db.transaction(() => {
    addStageEvent(
      row.application_id,
      row.suggested_stage as Stage,
      row.evidence ? `via ${row.source}: ${row.evidence.slice(0, 200)}` : null,
      row.occurred_at ?? undefined,
    );
    db.prepare(`UPDATE suggestions SET status = 'accepted' WHERE id = ?`).run(id);
  });
  tx();
  return mapSuggestion(selectSuggestion.get(id)!);
}

export function dismissSuggestion(id: string): Suggestion | undefined {
  const row = selectSuggestion.get(id);
  if (!row) return undefined;
  if (row.status === "pending") {
    db.prepare(`UPDATE suggestions SET status = 'dismissed' WHERE id = ?`).run(id);
  }
  return mapSuggestion(selectSuggestion.get(id)!);
}
