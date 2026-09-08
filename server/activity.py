"""The activity log — a second append-only stream, this one across every entity.

`stage_events` records what a transition was and *when it happened*; it has no
idea when you sat down and typed it. That is fine for a funnel and useless for
the question "how much did the search actually move this week?", because
`add_stage_event` accepts an explicit `occurred_at`: booking a first round for
next Thursday writes a row dated next Thursday, and this week's real work — you
heard back — leaves no trace anywhere.

So every write in the data layer also lands here, with the two facts kept apart:

  recorded_at  when you entered it. Always now, never supplied by the caller.
  occurred_at  the real-world date the entry refers to — the interview date, the
               application date, the interaction date. NULL when the thing has
               no date of its own, which is most edits.

Rows are never updated or deleted. Note the absence of foreign keys on
`application_id` / `contact_id` in the schema, and the denormalized `summary`:
both exist so the row recording a deletion outlives the row it describes.
"""
import contextlib
import contextvars
import json
import sqlite3
from typing import Any, Iterable, Optional

from .ids import nanoid, now_iso

# Where a write came from. Defaults to the app because that is what a request
# is; bulk loaders set it so 88 rows arriving in one second are distinguishable
# from 88 things you did. A ContextVar rather than a global because each ASGI
# request may land on its own thread.
_source: contextvars.ContextVar[str] = contextvars.ContextVar(
    "activity_source", default="app"
)

CREATED = "created"
UPDATED = "updated"
DELETED = "deleted"


@contextlib.contextmanager
def using_source(name: str):
    """Tag everything recorded inside this block as coming from `name`."""
    token = _source.set(name)
    try:
        yield
    finally:
        _source.reset(token)


_INSERT = """
  INSERT INTO activity (
    id, entity, entity_id, action, application_id, contact_id,
    summary, changes, occurred_at, recorded_at, source
  ) VALUES (
    :id, :entity, :entity_id, :action, :application_id, :contact_id,
    :summary, :changes, :occurred_at, :recorded_at, :source
  )
"""


def record(
    conn: sqlite3.Connection,
    entity: str,
    entity_id: str,
    action: str,
    *,
    summary: str,
    application_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    changes: Optional[dict] = None,
    occurred_at: Optional[str] = None,
) -> None:
    """Append one entry. Callers pass what happened; the clock is ours."""
    conn.execute(
        _INSERT,
        {
            "id": nanoid(),
            "entity": entity,
            "entity_id": entity_id,
            "action": action,
            "application_id": application_id,
            "contact_id": contact_id,
            "summary": summary,
            "changes": json.dumps(changes) if changes else None,
            "occurred_at": occurred_at,
            "recorded_at": now_iso(),
            "source": _source.get(),
        },
    )


def diff(
    before: Optional[dict], after: Optional[dict], fields: Iterable[str]
) -> Optional[dict]:
    """`{field: [before, after]}` for the fields that actually moved.

    Returns None when nothing changed, so re-saving a form untouched doesn't
    litter the log with entries that say nothing. `fields` is the caller's
    editable-key map (repo.EDITABLE and friends), which keeps the recorded
    names identical to the camelCase the API speaks.
    """
    if not before or not after:
        return None
    changed = {
        f: [before.get(f), after.get(f)]
        for f in fields
        if before.get(f) != after.get(f)
    }
    return changed or None


def _map(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "entity": r["entity"],
        "entityId": r["entity_id"],
        "action": r["action"],
        "applicationId": r["application_id"],
        "contactId": r["contact_id"],
        "summary": r["summary"],
        "changes": json.loads(r["changes"]) if r["changes"] else None,
        "occurredAt": r["occurred_at"],
        "recordedAt": r["recorded_at"],
        "source": r["source"],
    }


def list_activity(
    conn: sqlite3.Connection,
    *,
    date_field: str = "recorded_at",
    frm: Optional[str] = None,
    to: Optional[str] = None,
    entity: Optional[str] = None,
    action: Optional[str] = None,
    application_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    """Newest first. `date_field` picks which of the two clocks to filter on —
    'recorded_at' answers "what did I hear this week", 'occurred_at' answers
    "what is on the calendar next week", from the same rows."""
    if date_field not in ("recorded_at", "occurred_at"):
        raise ValueError(f"invalid date_field: {date_field}")
    where: list[str] = []
    params: dict[str, Any] = {}
    if frm:
        where.append(f"{date_field} >= :frm")
        params["frm"] = frm
    if to:
        # Inclusive of the whole `to` day when a bare date is given, so a
        # Monday–Sunday range doesn't silently drop Sunday's entries.
        where.append(f"{date_field} <= :to")
        params["to"] = f"{to}T23:59:59.999Z" if len(to) == 10 else to
    if date_field == "occurred_at":
        # An entry with no date of its own can't answer a calendar question.
        where.append("occurred_at IS NOT NULL")
    for col, val in (
        ("entity", entity),
        ("action", action),
        ("application_id", application_id),
        ("contact_id", contact_id),
        ("source", source),
    ):
        if val:
            where.append(f"{col} = :{col}")
            params[col] = val
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params["limit"] = max(1, min(limit, 1000))
    rows = conn.execute(
        f"""SELECT * FROM activity {clause}
             ORDER BY {date_field} DESC, id DESC
             LIMIT :limit""",
        params,
    ).fetchall()
    return [_map(r) for r in rows]
