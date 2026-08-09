"""Suggest-only inbox for externally detected stage changes — the port of
src/server's suggestions.ts. Nothing touches the event log until a suggestion
is accepted.
"""
import sqlite3
from typing import Optional, Union

from .ids import nanoid, now_iso
from .repo import add_stage_event

_SELECT_ONE = """
  SELECT s.*, a.company, a.role_title
  FROM suggestions s JOIN applications a ON a.id = s.application_id
  WHERE s.id = ?
"""


def _map_suggestion(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "applicationId": r["application_id"],
        "suggestedStage": r["suggested_stage"],
        "evidence": r["evidence"],
        "source": r["source"],
        "status": r["status"],
        "occurredAt": r["occurred_at"],
        "createdAt": r["created_at"],
        "company": r["company"],
        "roleTitle": r["role_title"],
    }


def list_pending_suggestions(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """SELECT s.*, a.company, a.role_title
           FROM suggestions s JOIN applications a ON a.id = s.application_id
           WHERE s.status = 'pending'
           ORDER BY s.created_at DESC"""
    )
    return [_map_suggestion(r) for r in rows]


def create_suggestion(
    conn: sqlite3.Connection, inp: dict
) -> Union[dict, str, None]:
    """Returns the suggestion dict, the string "already-recorded", or None if
    the application doesn't exist. Deduplicates against pending suggestions so
    re-scans are idempotent."""
    if not conn.execute(
        "SELECT 1 FROM applications WHERE id = ?", (inp["applicationId"],)
    ).fetchone():
        return None
    # A stage the log already contains needs no suggestion — this keeps scans
    # over historical email from re-suggesting every known outcome.
    already = conn.execute(
        "SELECT 1 FROM stage_events WHERE application_id = ? AND stage = ?",
        (inp["applicationId"], inp["suggestedStage"]),
    ).fetchone()
    if already:
        return "already-recorded"
    dup = conn.execute(
        """SELECT id FROM suggestions
           WHERE application_id = ? AND suggested_stage = ? AND status = 'pending'""",
        (inp["applicationId"], inp["suggestedStage"]),
    ).fetchone()
    sid = dup["id"] if dup else nanoid()
    if not dup:
        conn.execute(
            """INSERT INTO suggestions
               (id, application_id, suggested_stage, evidence, source, status, occurred_at, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (
                sid,
                inp["applicationId"],
                inp["suggestedStage"],
                inp.get("evidence"),
                inp.get("source") or "email",
                inp.get("occurredAt"),
                now_iso(),
            ),
        )
    row = conn.execute(_SELECT_ONE, (sid,)).fetchone()
    return _map_suggestion(row) if row else None


def accept_suggestion(conn: sqlite3.Connection, sid: str) -> Optional[dict]:
    """Accepting appends the suggested stage event (dated when the evidence
    happened, if known) and closes the suggestion."""
    row = conn.execute(_SELECT_ONE, (sid,)).fetchone()
    if not row:
        return None
    if row["status"] != "pending":
        return _map_suggestion(row)
    note = (
        f"via {row['source']}: {row['evidence'][:200]}" if row["evidence"] else None
    )
    add_stage_event(
        conn,
        row["application_id"],
        row["suggested_stage"],
        note,
        row["occurred_at"] or None,
    )
    conn.execute("UPDATE suggestions SET status = 'accepted' WHERE id = ?", (sid,))
    return _map_suggestion(conn.execute(_SELECT_ONE, (sid,)).fetchone())


def dismiss_suggestion(conn: sqlite3.Connection, sid: str) -> Optional[dict]:
    row = conn.execute(_SELECT_ONE, (sid,)).fetchone()
    if not row:
        return None
    if row["status"] == "pending":
        conn.execute(
            "UPDATE suggestions SET status = 'dismissed' WHERE id = ?", (sid,)
        )
    return _map_suggestion(conn.execute(_SELECT_ONE, (sid,)).fetchone())
