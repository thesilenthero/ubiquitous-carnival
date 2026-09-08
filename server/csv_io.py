"""CSV export + the migration import parser — the port of src/server's csv.ts.

The export is the escape hatch against lock-in: every field, the stage history,
and the archived job description / resume text.

One application is more than its row, though — it also has the stage events that
produced it, the interviews it led to, and the engagements with the people
behind it. Those get their own files, keyed by application_id, and EXPORT_FILES
is the single list of what "the export" means. Both consumers (the /export.zip
route and the Drive mirror in csv_backup.py) iterate it, so the set can't drift.
"""
import sqlite3
from typing import Callable

from .domain import PRE_STAGES, STAGE_LABELS
from .repo import get_application, list_applications

EXPORT_COLUMNS = [
    "id",
    "company",
    "role_title",
    "source",
    "date_applied",
    "current_stage",
    "stage_changed_at",
    "location",
    "work_mode",
    "salary_min",
    "salary_max",
    "salary_period",
    "contact_name",
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
]


def _csv_cell(value) -> str:
    if value is None:
        return ""
    s = str(value)
    if any(ch in s for ch in (",", '"', "\n")):
        return '"' + s.replace('"', '""') + '"'
    return s


def export_csv(conn: sqlite3.Connection) -> str:
    lines = [",".join(EXPORT_COLUMNS)]
    for a in list_applications(conn):
        full = get_application(conn, a["id"])
        assert full is not None
        history = " | ".join(
            f"{STAGE_LABELS[e['stage']]}@{e['occurredAt']}"
            for e in full.get("events", [])
        )
        cells = [
            a["id"],
            a["company"],
            a["roleTitle"],
            a["source"],
            # A row still on the docket carries a placeholder date, not a real
            # one — export it blank rather than let it read as an apply date.
            ("" if a["currentStage"] in PRE_STAGES else a["dateApplied"]),
            a["currentStage"],
            a["stageChangedAt"],
            a["location"],
            a["workMode"],
            a["salaryMin"],
            a["salaryMax"],
            a["salaryPeriod"],
            a["contactName"],
            a["industry"],
            a["roleType"],
            a["jobUrl"],
            a["nextAction"],
            a["nextActionDate"],
            "yes" if a["archived"] else "no",
            a["notes"],
            full["jobDescription"],
            full["resumeText"],
            history,
        ]
        lines.append(",".join(_csv_cell(c) for c in cells))
    return "\n".join(lines)


def _csv_text(columns: list[str], rows: list[sqlite3.Row]) -> str:
    """Render rows straight out of a SELECT whose columns are already in order."""
    lines = [",".join(columns)]
    lines.extend(",".join(_csv_cell(v) for v in tuple(r)) for r in rows)
    return "\n".join(lines)


# The stage log, unflattened. The applications CSV squeezes this into one
# `stage_history` cell of "Label@timestamp" pairs, which drops every note and
# can't be read back — here each transition is a row, with its note intact.
STAGE_EVENT_COLUMNS = [
    "id",
    "application_id",
    "company",
    "role_title",
    "stage",
    "stage_label",
    "note",
    "occurred_at",
]

_STAGE_EVENTS_SQL = """
    SELECT e.id, e.application_id, a.company, a.role_title, e.stage,
           e.note, e.occurred_at
      FROM stage_events e
      JOIN applications a ON a.id = e.application_id
     ORDER BY a.company, e.occurred_at
"""


def export_stage_events_csv(conn: sqlite3.Connection) -> str:
    # Both spellings of the stage: the key, so the file can be read back, and
    # the label, so it can be read.
    rows = [
        (
            r["id"],
            r["application_id"],
            r["company"],
            r["role_title"],
            r["stage"],
            STAGE_LABELS.get(r["stage"], r["stage"]),
            r["note"],
            r["occurred_at"],
        )
        for r in conn.execute(_STAGE_EVENTS_SQL)
    ]
    lines = [",".join(STAGE_EVENT_COLUMNS)]
    lines.extend(",".join(_csv_cell(v) for v in row) for row in rows)
    return "\n".join(lines)


INTERVIEW_COLUMNS = [
    "id",
    "application_id",
    "company",
    "role_title",
    "stage_event_id",
    "date",
    "format",
    "interviewers",
    "notes",
    "created_at",
    "updated_at",
]

_INTERVIEWS_SQL = """
    SELECT i.id, i.application_id, a.company, a.role_title, i.stage_event_id,
           i.date, i.format, i.interviewers, i.notes,
           i.created_at, i.updated_at
      FROM interviews i
      JOIN applications a ON a.id = i.application_id
     ORDER BY i.date, a.company
"""


def export_interviews_csv(conn: sqlite3.Connection) -> str:
    return _csv_text(INTERVIEW_COLUMNS, conn.execute(_INTERVIEWS_SQL).fetchall())


# Engagements: every touch with a contact, and the application it was about.
# Contacts aren't a file of their own, so the contact's name and company ride
# along — the file has to be readable on its own, not just joinable.
INTERACTION_COLUMNS = [
    "id",
    "contact_id",
    "contact_name",
    "contact_company",
    "application_id",
    "company",
    "role_title",
    "kind",
    "note",
    "occurred_at",
]

# LEFT JOIN on applications: an interaction can be general networking with no
# application behind it, and those are exactly the ones worth keeping.
_INTERACTIONS_SQL = """
    SELECT n.id, n.contact_id, c.name, c.company, n.application_id,
           a.company, a.role_title, n.kind, n.note, n.occurred_at
      FROM interactions n
      LEFT JOIN contacts c ON c.id = n.contact_id
      LEFT JOIN applications a ON a.id = n.application_id
     ORDER BY n.occurred_at
"""


def export_interactions_csv(conn: sqlite3.Connection) -> str:
    return _csv_text(INTERACTION_COLUMNS, conn.execute(_INTERACTIONS_SQL).fetchall())


# The activity log. `changes` stays raw JSON in its cell — a spreadsheet can't
# do anything useful with a nested diff, and flattening it into columns would
# mean one column per editable field across every entity.
ACTIVITY_COLUMNS = [
    "id",
    "entity",
    "entity_id",
    "action",
    "application_id",
    "company",
    "role_title",
    "contact_id",
    "contact_name",
    "summary",
    "changes",
    "occurred_at",
    "recorded_at",
    "source",
]

# LEFT JOINs throughout, and they have to be: an entry describing a deletion
# outlives its subject on purpose, so the join simply finds nothing. Ordered by
# recorded_at because that is the axis a person scanning the file is asking
# about — what happened, in the order it reached me.
_ACTIVITY_SQL = """
    SELECT v.id, v.entity, v.entity_id, v.action, v.application_id,
           a.company, a.role_title, v.contact_id, c.name,
           v.summary, v.changes, v.occurred_at, v.recorded_at, v.source
      FROM activity v
      LEFT JOIN applications a ON a.id = v.application_id
      LEFT JOIN contacts c ON c.id = v.contact_id
     ORDER BY v.recorded_at, v.id
"""


def export_activity_csv(conn: sqlite3.Connection) -> str:
    return _csv_text(ACTIVITY_COLUMNS, conn.execute(_ACTIVITY_SQL).fetchall())


# What "the export" is. Names are the entries inside the zip; csv_backup.py maps
# them to its own job-*.csv filenames for the synced folder.
EXPORT_FILES: dict[str, Callable[[sqlite3.Connection], str]] = {
    "applications.csv": export_csv,
    "stage-events.csv": export_stage_events_csv,
    "interviews.csv": export_interviews_csv,
    "interactions.csv": export_interactions_csv,
    "activity.csv": export_activity_csv,
}


def parse_csv(text: str) -> list[list[str]]:
    """Minimal RFC-4180-ish parser: quoted fields, escaped quotes, commas and
    newlines inside quotes. (Port of the hand-rolled TS parser so /api/import
    behaves identically.)"""
    rows: list[list[str]] = []
    row: list[str] = []
    field = ""
    in_quotes = False
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    i = 0
    while i < len(s):
        c = s[i]
        if in_quotes:
            if c == '"':
                if i + 1 < len(s) and s[i + 1] == '"':
                    field += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                field += c
        elif c == '"':
            in_quotes = True
        elif c == ",":
            row.append(field)
            field = ""
        elif c == "\n":
            row.append(field)
            rows.append(row)
            row = []
            field = ""
        else:
            field += c
        i += 1
    if field or row:
        row.append(field)
        rows.append(row)
    return [r for r in rows if any(c.strip() for c in r)]
