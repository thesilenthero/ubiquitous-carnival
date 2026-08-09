import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The database lives in ./data at the repo root. It is a real, durable file —
// not browser storage — so data survives across sessions, restarts, and (when
// this server is hosted) devices. The path is overridable for tests.
const DB_PATH =
  process.env.DB_PATH ?? resolve(__dirname, "../../data/app.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

let schemaReady = false;
export function initSchema(): void {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id             TEXT PRIMARY KEY,
      company        TEXT NOT NULL,
      role_title     TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'other',
      date_applied   TEXT NOT NULL,            -- ISO date (YYYY-MM-DD)
      location       TEXT,
      remote         INTEGER NOT NULL DEFAULT 0, -- 0/1 boolean
      salary_min     INTEGER,
      salary_max     INTEGER,
      contact_name   TEXT,
      referral_source TEXT,
      industry       TEXT,
      role_type      TEXT,
      notes          TEXT,
      next_action    TEXT,
      next_action_date TEXT,                   -- ISO date, nullable
      archived       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    -- Append-only event log. This is the single most important modeling
    -- decision: status is an event stream, and current stage is derived as the
    -- latest event. Rows are never updated or deleted in normal operation.
    CREATE TABLE IF NOT EXISTS stage_events (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      stage          TEXT NOT NULL,
      note           TEXT,
      occurred_at    TEXT NOT NULL             -- ISO timestamp of the transition
    );

    CREATE INDEX IF NOT EXISTS idx_events_app ON stage_events(application_id);
    CREATE INDEX IF NOT EXISTS idx_events_time ON stage_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_app_archived ON applications(archived);

    -- Networking contacts (the sheet's Outreach tab) with their own
    -- interaction log, mirroring the stage_events pattern.
    CREATE TABLE IF NOT EXISTS contacts (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      company          TEXT,
      role_title       TEXT,
      relationship     TEXT,
      status           TEXT NOT NULL DEFAULT 'Pending',
      email            TEXT,
      linkedin_url     TEXT,
      next_action      TEXT,
      next_action_date TEXT,
      notes            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id             TEXT PRIMARY KEY,
      contact_id     TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
      kind           TEXT NOT NULL,
      note           TEXT,
      occurred_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions(contact_id);

    -- Interview rounds. A row is auto-created as a stub when an interview-type
    -- stage event is recorded, then filled in (interviewers, questions, retro)
    -- by hand — the log itself never requires double entry.
    CREATE TABLE IF NOT EXISTS interviews (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      stage_event_id TEXT,          -- stage event that spawned the stub, if any
      date           TEXT,          -- ISO date
      format         TEXT,
      interviewers   TEXT,
      questions      TEXT,
      notes          TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_interviews_app ON interviews(application_id);

    -- Suggest-only inbox for externally detected stage changes (e.g. a Gmail
    -- scan finding a rejection email). Nothing touches the event log until a
    -- suggestion is explicitly accepted in the UI.
    CREATE TABLE IF NOT EXISTS suggestions (
      id              TEXT PRIMARY KEY,
      application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      suggested_stage TEXT NOT NULL,
      evidence        TEXT,
      source          TEXT NOT NULL DEFAULT 'email',
      status          TEXT NOT NULL DEFAULT 'pending', -- pending/accepted/dismissed
      occurred_at     TEXT,         -- when the evidence happened (email date)
      created_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Idempotent migrations for databases created before a column existed.
  ensureColumn("applications", "industry", "TEXT");
  ensureColumn("applications", "role_type", "TEXT");
  ensureColumn("applications", "job_url", "TEXT");
  ensureColumn("applications", "job_description", "TEXT");
  ensureColumn("applications", "resume_text", "TEXT");
  schemaReady = true;
}

// Add a column to an existing table only if it isn't already present.
function ensureColumn(table: string, column: string, decl: string): void {
  const cols = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

// Create the schema at module load, before any module that imports `db`
// prepares statements against these tables.
initSchema();
