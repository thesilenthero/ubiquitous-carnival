"""Database connection + schema — the Python port of src/server's db.ts.

The database lives in ./data at the repo root: a real, durable file, path
overridable with DB_PATH. Each caller gets its own short-lived connection
(SQLite connections are cheap and this sidesteps cross-thread sharing under
the ASGI threadpool); WAL journaling is a property of the file itself.
"""
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("DB_PATH") or str(REPO_ROOT / "data" / "app.db")

Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
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
"""


def connect() -> sqlite3.Connection:
    # check_same_thread=False: under ASGI a request's dependency and handler
    # can run on different threads; each connection still serves one request.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    """Add a column to an existing table only if it isn't already present."""
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_schema() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        # Idempotent migrations for databases created before a column existed.
        _ensure_column(conn, "applications", "industry", "TEXT")
        _ensure_column(conn, "applications", "role_type", "TEXT")
        _ensure_column(conn, "applications", "job_url", "TEXT")
        _ensure_column(conn, "applications", "job_description", "TEXT")
        _ensure_column(conn, "applications", "resume_text", "TEXT")
        # Job-evaluation snapshot, saved when an evaluation is converted into
        # an application. eval_composite/eval_verdict are denormalized for
        # display and sorting; `evaluation` holds the full rich JSON blob.
        _ensure_column(conn, "applications", "eval_composite", "REAL")
        _ensure_column(conn, "applications", "eval_verdict", "TEXT")
        _ensure_column(conn, "applications", "evaluation", "TEXT")
        conn.commit()
    finally:
        conn.close()


def get_db():
    """FastAPI dependency: one connection per request, always closed."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
