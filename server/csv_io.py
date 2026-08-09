"""CSV export + the migration import parser — the port of src/server's csv.ts.

The export is the escape hatch against lock-in: every field, the stage history,
and the archived job description / resume text.
"""
import sqlite3

from .domain import STAGE_LABELS
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
            a["dateApplied"],
            a["currentStage"],
            a["stageChangedAt"],
            a["location"],
            "yes" if a["remote"] else "no",
            a["salaryMin"],
            a["salaryMax"],
            a["contactName"],
            a["referralSource"],
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
