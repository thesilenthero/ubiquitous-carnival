"""Networking contacts + interaction log — the port of src/server's contacts.ts.

Interactions are appended (mirroring the stage_events pattern) and a contact's
"last touch" is derived from them.
"""
import sqlite3
from typing import Any, Optional

from .ids import nanoid, now_iso

CONTACT_EDITABLE = {
    "name": "name",
    "company": "company",
    "roleTitle": "role_title",
    "relationship": "relationship",
    "status": "status",
    "email": "email",
    "linkedinUrl": "linkedin_url",
    "nextAction": "next_action",
    "nextActionDate": "next_action_date",
    "notes": "notes",
}

_INTERACTIONS_FOR = """
  SELECT * FROM interactions WHERE contact_id = ?
  ORDER BY occurred_at DESC, id DESC
"""

# Last interaction per contact in one query (same pattern as the application
# list's latest-event lookup).
_LAST_INTERACTION_PER_CONTACT = """
  SELECT contact_id, MAX(occurred_at) AS occurred_at
  FROM interactions GROUP BY contact_id
"""


def _map_interaction(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "contactId": r["contact_id"],
        "applicationId": r["application_id"],
        "kind": r["kind"],
        "note": r["note"],
        "occurredAt": r["occurred_at"],
    }


def _map_contact(
    conn: sqlite3.Connection,
    r: sqlite3.Row,
    last_at: Optional[str],
    include_interactions: bool = False,
) -> dict:
    c = {
        "id": r["id"],
        "name": r["name"],
        "company": r["company"],
        "roleTitle": r["role_title"],
        "relationship": r["relationship"],
        "status": r["status"],
        "email": r["email"],
        "linkedinUrl": r["linkedin_url"],
        "nextAction": r["next_action"],
        "nextActionDate": r["next_action_date"],
        "notes": r["notes"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "lastInteractionAt": last_at,
    }
    if include_interactions:
        c["interactions"] = [
            _map_interaction(i) for i in conn.execute(_INTERACTIONS_FOR, (r["id"],))
        ]
    return c


def list_contacts(conn: sqlite3.Connection) -> list[dict]:
    last_by_contact = {
        r["contact_id"]: r["occurred_at"]
        for r in conn.execute(_LAST_INTERACTION_PER_CONTACT)
    }
    return [
        _map_contact(conn, r, last_by_contact.get(r["id"]), True)
        for r in conn.execute("SELECT * FROM contacts ORDER BY updated_at DESC")
    ]


def get_contact(conn: sqlite3.Connection, contact_id: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM contacts WHERE id = ?", (contact_id,)
    ).fetchone()
    if not row:
        return None
    interactions = conn.execute(_INTERACTIONS_FOR, (contact_id,)).fetchall()
    last_at = interactions[0]["occurred_at"] if interactions else None
    c = _map_contact(conn, row, last_at, False)
    c["interactions"] = [_map_interaction(i) for i in interactions]
    return c


def create_contact(conn: sqlite3.Connection, inp: dict) -> dict:
    now = now_iso()
    contact_id = nanoid()
    conn.execute(
        """INSERT INTO contacts (
             id, name, company, role_title, relationship, status, email,
             linkedin_url, next_action, next_action_date, notes,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            contact_id,
            inp["name"],
            inp.get("company"),
            inp.get("roleTitle"),
            inp.get("relationship"),
            inp.get("status") or "Pending",
            inp.get("email"),
            inp.get("linkedinUrl"),
            inp.get("nextAction"),
            inp.get("nextActionDate"),
            inp.get("notes"),
            now,
            now,
        ),
    )
    return get_contact(conn, contact_id)  # type: ignore[return-value]


def update_contact(
    conn: sqlite3.Connection, contact_id: str, patch: dict
) -> Optional[dict]:
    if not conn.execute(
        "SELECT 1 FROM contacts WHERE id = ?", (contact_id,)
    ).fetchone():
        return None
    sets: list[str] = []
    params: dict[str, Any] = {"id": contact_id}
    for key, col in CONTACT_EDITABLE.items():
        if key in patch:
            sets.append(f"{col} = :{col}")
            params[col] = patch[key]
    if sets:
        params["updated_at"] = now_iso()
        sets.append("updated_at = :updated_at")
        conn.execute(
            f"UPDATE contacts SET {', '.join(sets)} WHERE id = :id", params
        )
    return get_contact(conn, contact_id)


def delete_contact(conn: sqlite3.Connection, contact_id: str) -> bool:
    cur = conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    return cur.rowcount > 0


def add_interaction(
    conn: sqlite3.Connection, contact_id: str, inp: dict
) -> Optional[dict]:
    if not conn.execute(
        "SELECT 1 FROM contacts WHERE id = ?", (contact_id,)
    ).fetchone():
        return None
    conn.execute(
        """INSERT INTO interactions (id, contact_id, application_id, kind, note, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            nanoid(),
            contact_id,
            inp.get("applicationId"),
            inp["kind"],
            inp.get("note"),
            inp.get("occurredAt") or now_iso(),
        ),
    )
    conn.execute(
        "UPDATE contacts SET updated_at = ? WHERE id = ?", (now_iso(), contact_id)
    )
    return get_contact(conn, contact_id)


def delete_interaction(
    conn: sqlite3.Connection, contact_id: str, interaction_id: str
) -> Optional[dict]:
    if not conn.execute(
        "SELECT 1 FROM contacts WHERE id = ?", (contact_id,)
    ).fetchone():
        return None
    conn.execute(
        "DELETE FROM interactions WHERE id = ? AND contact_id = ?",
        (interaction_id, contact_id),
    )
    return get_contact(conn, contact_id)
