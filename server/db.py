"""Database connection + schema — the Python port of src/server's db.ts.

The database lives in ./data at the repo root: a real, durable file, path
overridable with DB_PATH. Each caller gets its own short-lived connection
(SQLite connections are cheap and this sidesteps cross-thread sharing under
the ASGI threadpool); WAL journaling is a property of the file itself.
"""
import os
import sqlite3
from pathlib import Path

from .domain import ATS_SOURCE_LABELS, SOURCES

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("DB_PATH") or str(REPO_ROOT / "data" / "app.db")

Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
    CREATE TABLE IF NOT EXISTS applications (
      id             TEXT PRIMARY KEY,
      company        TEXT NOT NULL,
      role_title     TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'Other',
      date_applied   TEXT NOT NULL,            -- ISO date (YYYY-MM-DD)
      location       TEXT,
      remote         INTEGER NOT NULL DEFAULT 0, -- legacy; superseded by work_mode
      salary_min     INTEGER,
      salary_max     INTEGER,
      contact_name   TEXT,
      referral_source TEXT,          -- legacy; `source` already records the channel
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
    -- stage event is recorded, then filled in (interviewers, notes) by hand —
    -- the log itself never requires double entry. `notes` is one field on
    -- purpose: questions asked, prep and retro are one account of one
    -- conversation, and splitting them only asked which box a thought went in.
    CREATE TABLE IF NOT EXISTS interviews (
      id             TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      stage_event_id TEXT,          -- stage event that spawned the stub, if any
      date           TEXT,          -- ISO date
      format         TEXT,
      interviewers   TEXT,
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

    -- Company ATS boards being watched for new postings. Board identity is not
    -- one field for every ATS: Workday has no shared API host (each tenant is
    -- {tenant}.wd{N}.myworkdayjobs.com with its own site slug), so host/site are
    -- populated there and null for the rest, which only need `slug`.
    -- `keywords` is a comma-separated title filter — without it a single large
    -- employer (Bosch has ~4,700 openings) would bury everything else.
    CREATE TABLE IF NOT EXISTS job_boards (
      id              TEXT PRIMARY KEY,
      ats             TEXT NOT NULL,  -- greenhouse/lever/ashby/smartrecruiters/workday
      host            TEXT,           -- Workday only: the tenant host
      slug            TEXT NOT NULL,  -- board token / company / Workday tenant
      site            TEXT,           -- Workday only: careers site slug
      company         TEXT NOT NULL,
      keywords        TEXT,           -- comma-separated; empty means keep all
      active          INTEGER NOT NULL DEFAULT 1, -- 0/1 boolean
      last_checked_at TEXT,
      last_error      TEXT,
      created_at      TEXT NOT NULL
    );

    -- Postings found by polling those boards — the MACHINE-FOUND half of the
    -- pre-application state, and the only half that lives outside
    -- `applications`. The hand-curated half is an application sitting at a
    -- pre-stage (server/domain.py PRE_STAGES); that is safe because
    -- analytics.py excludes those rows outright, so an un-applied role still
    -- cannot move a rate. A discovered posting stays here until you docket or
    -- apply to it, at which point it becomes a real application row.
    CREATE TABLE IF NOT EXISTS discovered_jobs (
      id             TEXT PRIMARY KEY,
      board_id       TEXT NOT NULL REFERENCES job_boards(id) ON DELETE CASCADE,
      external_id    TEXT NOT NULL,   -- the ATS's own id for the posting
      job_url        TEXT NOT NULL,
      company        TEXT NOT NULL,
      role_title     TEXT NOT NULL,
      location       TEXT,
      remote         INTEGER,         -- 0/1 boolean, null when the board is silent
      salary_min     INTEGER,
      salary_max     INTEGER,
      posted_at      TEXT,            -- display string as the board words it
      role_type      TEXT,
      first_seen_at  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'new', -- new/saved/dismissed/applied
      application_id TEXT REFERENCES applications(id) ON DELETE SET NULL
    );

    -- The only UNIQUE constraint in this schema, and a deliberate one: polling
    -- must be idempotent structurally, not because a dedupe query happens to be
    -- right. Inserts use ON CONFLICT DO NOTHING so a re-refresh is a no-op.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_unique
      ON discovered_jobs(board_id, external_id);
    CREATE INDEX IF NOT EXISTS idx_discovered_status ON discovered_jobs(status);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- The activity log: a second append-only stream, this one spanning every
    -- entity. `stage_events` says when a transition HAPPENED and cannot say
    -- when it was ENTERED — a first round booked for next Thursday is a row
    -- dated next Thursday, so the week you actually heard back is invisible.
    -- Here the two clocks are separate columns; see server/activity.py.
    --
    -- application_id and contact_id carry NO foreign key on purpose. Every
    -- other child table here cascades on delete, which would erase the row
    -- recording the deletion along with its subject. `summary` is denormalized
    -- text for the same reason: a deletion entry has to still read afterwards.
    CREATE TABLE IF NOT EXISTS activity (
      id             TEXT PRIMARY KEY,
      entity         TEXT NOT NULL,   -- application/stage_event/interview/contact/
                                      -- interaction/attachment/suggestion/board/
                                      -- posting/snooze/settings
      entity_id      TEXT NOT NULL,
      action         TEXT NOT NULL,   -- created | updated | deleted
      application_id TEXT,            -- denormalized owner, for a per-app timeline
      contact_id     TEXT,
      summary        TEXT NOT NULL,   -- one-line human reading, written at record time
      changes        TEXT,            -- JSON {field: [before, after]}, updates only
      occurred_at    TEXT,            -- the real-world date it refers to; NULL = none
      recorded_at    TEXT NOT NULL,   -- when it was entered
      source         TEXT NOT NULL DEFAULT 'app'
    );
    CREATE INDEX IF NOT EXISTS idx_activity_recorded ON activity(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_activity_app ON activity(application_id);
    CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity, entity_id);

    -- "Not now" for a computed next-step play. The plays themselves are
    -- derived on every request and never stored; this is the only state they
    -- have, and it expires on purpose — if the situation still holds when the
    -- snooze lapses, the suggestion is still the right one.
    CREATE TABLE IF NOT EXISTS next_step_snoozes (
      id         TEXT PRIMARY KEY,   -- the play's stable id, play:kind:subject
      until      TEXT NOT NULL,      -- ISO date; hidden while today < until
      created_at TEXT NOT NULL
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


def _merge_interview_questions(conn: sqlite3.Connection) -> None:
    """Fold the old `questions` column into `notes`, then drop it.

    An interview round used to offer two boxes — questions asked, and prep/retro
    notes — for what people actually write as one account of one conversation.
    The rows bore that out: the only round that ever used both read straight
    through from one into the other. The "question bank" the split was for was
    never built, so the second box cost a decision every time and bought nothing.

    Guarded on the column existing rather than on a version flag, so this is
    self-healing: restore a pre-merge backup into data/ and the next startup
    merges and drops again, instead of leaving half-migrated rows behind. That
    is what lets this drop a column at all — see the note on `remote` below,
    where leaving it in place was the safer call.
    """
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(interviews)")]
    if "questions" not in cols:
        return

    # Labeled and first: the heading is what keeps the merged text readable once
    # the field that gave it its meaning is gone. Rows with no notes get the
    # heading too, so every migrated round reads the same way.
    conn.execute(
        """UPDATE interviews
              SET notes = 'Questions asked:' || char(10) || TRIM(questions)
                        || CASE WHEN COALESCE(TRIM(notes), '') = '' THEN ''
                                ELSE char(10) || char(10) || notes END
            WHERE COALESCE(TRIM(questions), '') <> ''"""
    )
    conn.execute("ALTER TABLE interviews DROP COLUMN questions")


def _backfill_work_mode(conn: sqlite3.Connection) -> None:
    """Derive work_mode once, for rows written before the column existed.

    The old boolean only distinguished fully-remote from everything else, so
    `remote = 0` genuinely cannot tell hybrid from on-site. Hybrid is the
    chosen reading: it is the common arrangement for these roles, and it
    matches the default new applications now get. Guarded on NULL, so a value
    set by hand afterwards is never overwritten by a later startup.
    """
    conn.execute(
        """UPDATE applications
              SET work_mode = CASE WHEN remote THEN 'remote' ELSE 'hybrid' END
            WHERE work_mode IS NULL"""
    )


def _normalize_sources(conn: sqlite3.Connection) -> None:
    """Snap stored sources onto their canonical casing.

    The source list started out mixed-case ("LinkedIn" beside "referral"), which
    left the Pipeline column reading raggedly and would split a case variant into
    its own bucket in any group-by. Idempotent — the guard means a startup with
    nothing to fix issues no writes — and one-way: only the spelling changes, so
    a source outside the known list is left exactly as typed.
    """
    for canonical in [*SOURCES, *ATS_SOURCE_LABELS.values()]:
        conn.execute(
            """UPDATE applications SET source = :canonical
                WHERE source = :canonical COLLATE NOCASE AND source != :canonical""",
            {"canonical": canonical},
        )


def _link_existing_contacts(conn: sqlite3.Connection) -> None:
    """Point applications at the contact their free-text name already names.

    Matched on the name alone, and only when exactly one contact matches —
    either outright or because the stored text is how you abbreviate them
    ("Vidushi S" for "Vidushi Sharma"). An ambiguous or absent match is left
    unlinked for you to set by hand; the free text is never modified.
    """
    rows = conn.execute(
        """SELECT id, contact_name FROM applications
            WHERE contact_id IS NULL AND trim(coalesce(contact_name, '')) != ''"""
    ).fetchall()
    for row in rows:
        name = row["contact_name"].strip()
        matches = conn.execute(
            """SELECT id FROM contacts
                WHERE name = ? COLLATE NOCASE OR name LIKE ? || '%' COLLATE NOCASE""",
            (name, name),
        ).fetchall()
        if len(matches) == 1:
            conn.execute(
                "UPDATE applications SET contact_id = ? WHERE id = ?",
                (matches[0]["id"], row["id"]),
            )


# What the activity log can recover about rows that predate it, per entity:
# the id, an owner, a summary, the date it refers to, and when it was entered.
# Ordered so the seeded log reads chronologically for equal timestamps.
_BACKFILLS = [
    (
        "application",
        """SELECT a.id AS entity_id, a.id AS application_id, NULL AS contact_id,
                  'Added ' || a.role_title || ' at ' || a.company AS summary,
                  a.date_applied AS occurred_at, a.created_at AS recorded_at
             FROM applications a""",
    ),
    (
        "contact",
        """SELECT c.id AS entity_id, NULL AS application_id, c.id AS contact_id,
                  'Added contact ' || c.name AS summary,
                  NULL AS occurred_at, c.created_at AS recorded_at
             FROM contacts c""",
    ),
    # stage_events and interactions have no created_at at all — see the note in
    # _backfill_activity about what recorded_at means for these.
    (
        "stage_event",
        """SELECT e.id AS entity_id, e.application_id AS application_id,
                  NULL AS contact_id,
                  'Recorded ' || e.stage || ' for ' || a.role_title
                    || ' at ' || a.company AS summary,
                  e.occurred_at AS occurred_at, e.occurred_at AS recorded_at
             FROM stage_events e JOIN applications a ON a.id = e.application_id""",
    ),
    (
        "interview",
        """SELECT i.id AS entity_id, i.application_id AS application_id,
                  NULL AS contact_id,
                  'Added interview for ' || a.role_title || ' at ' || a.company
                    AS summary,
                  i.date AS occurred_at, i.created_at AS recorded_at
             FROM interviews i JOIN applications a ON a.id = i.application_id""",
    ),
    (
        "interaction",
        """SELECT x.id AS entity_id, x.application_id AS application_id,
                  x.contact_id AS contact_id,
                  'Logged ' || x.kind || ' with ' || c.name AS summary,
                  x.occurred_at AS occurred_at, x.occurred_at AS recorded_at
             FROM interactions x JOIN contacts c ON c.id = x.contact_id""",
    ),
]


def _backfill_activity(conn: sqlite3.Connection) -> None:
    """Seed the activity log from what the existing rows already know.

    Without this the log is empty on the day it ships and a year of real search
    history is invisible, which is most of the point of having it.

    Every synthesized row is tagged source='backfill', and that tag matters:
    `stage_events` and `interactions` have no created_at, so when a past entry
    was *typed* is genuinely unrecoverable. Setting recorded_at = occurred_at is
    the only defensible fallback and it is exactly the conflation this feature
    exists to end — so the tag is there for any later lead-time metric to
    exclude, rather than have it read a guess as an observation.

    Idempotent the same way the other startup fixups are: the NOT EXISTS guard
    means a startup with nothing to add issues no writes, and a row restored
    from an older backup later still gets its entry.
    """
    for entity, select in _BACKFILLS:
        conn.execute(
            f"""INSERT INTO activity (
                  id, entity, entity_id, action, application_id, contact_id,
                  summary, changes, occurred_at, recorded_at, source
                )
                SELECT lower(hex(randomblob(10))), :entity, src.entity_id,
                       'created', src.application_id, src.contact_id,
                       src.summary, NULL, src.occurred_at, src.recorded_at,
                       'backfill'
                  FROM ({select}) AS src
                 WHERE NOT EXISTS (
                   SELECT 1 FROM activity a
                    WHERE a.entity = :entity AND a.entity_id = src.entity_id
                 )""",
            {"entity": entity},
        )


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
        # The attached resume PDF. The bytes live on disk under data/resumes/
        # (see server/attachment_files.py) — at ~440 uploads a month a BLOB would
        # push this file past a gigabyte a year, and every manual backup copy
        # with it. `resume_path` is a bare generated filename, never a path from
        # the client and never absolute, so moving the data directory still works.
        _ensure_column(conn, "applications", "resume_filename", "TEXT")
        _ensure_column(conn, "applications", "resume_path", "TEXT")
        _ensure_column(conn, "applications", "resume_size", "INTEGER")
        _ensure_column(conn, "applications", "resume_uploaded_at", "TEXT")
        # The attached cover letter PDF — same five columns, same reasoning as
        # the resume above, stored under data/cover_letters/. `cover_letter_text`
        # is new here (resume_text predates attachments), and holds the extracted
        # text layer so the letter stays searchable after the file is detached.
        _ensure_column(conn, "applications", "cover_letter_text", "TEXT")
        _ensure_column(conn, "applications", "cover_letter_filename", "TEXT")
        _ensure_column(conn, "applications", "cover_letter_path", "TEXT")
        _ensure_column(conn, "applications", "cover_letter_size", "INTEGER")
        _ensure_column(conn, "applications", "cover_letter_uploaded_at", "TEXT")
        # Where the work happens. This replaces the `remote` boolean, which
        # could only say "fully remote or not" and so collapsed hybrid and
        # on-site into one indistinguishable state. `remote` is left in place
        # (unread) rather than dropped, so an older backup still restores.
        _ensure_column(conn, "applications", "work_mode", "TEXT")
        _backfill_work_mode(conn)
        # Contract roles quote an hourly rate, so a salary figure is meaningless
        # without its period. 'year' matches every row that predates this.
        _ensure_column(conn, "applications", "salary_period", "TEXT")
        conn.execute(
            "UPDATE applications SET salary_period = 'year' WHERE salary_period IS NULL"
        )
        # Who referred you, as a real contact rather than a retyped name. The
        # free-text contact_name remains as the fallback for people who aren't
        # in the contact list, and as the display name for those who are.
        _ensure_column(
            conn,
            "applications",
            "contact_id",
            "TEXT REFERENCES contacts(id) ON DELETE SET NULL",
        )
        _link_existing_contacts(conn)
        # Which folder in the attachment archive this application owns. Recorded
        # rather than recomputed because its inputs move — date_applied is
        # rewritten when a docketed role reaches `applied` — and a recomputed
        # name would scatter one application's documents across several folders.
        _ensure_column(conn, "applications", "backup_dir", "TEXT")
        _normalize_sources(conn)
        # Two interview note fields became one; see the docstring.
        _merge_interview_questions(conn)
        # Last: the backfill reads columns the migrations above may have just
        # added, and it should see the final state of every row.
        _backfill_activity(conn)
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
