"""Contact routes — the port of src/server's routes/contacts.ts."""
import sqlite3

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .. import contacts as store
from ..db import get_db
from ..domain import is_iso_date, is_iso_timestamp

router = APIRouter()


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


@router.get("")
def list_contacts(conn: sqlite3.Connection = Depends(get_db)):
    return store.list_contacts(conn)


@router.get("/{contact_id}")
def get_contact(contact_id: str, conn: sqlite3.Connection = Depends(get_db)):
    c = store.get_contact(conn, contact_id)
    if not c:
        return _err(404, "Not found")
    return c


@router.post("")
async def create_contact(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    name = b.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        return _err(400, "name is required")
    if b.get("nextActionDate") and not is_iso_date(b["nextActionDate"]):
        return _err(400, f"invalid nextActionDate: {b['nextActionDate']}")
    inp = {
        "name": name.strip(),
        "company": b.get("company"),
        "roleTitle": b.get("roleTitle"),
        "relationship": b.get("relationship"),
        "status": b.get("status"),
        "email": b.get("email"),
        "linkedinUrl": b.get("linkedinUrl"),
        "nextAction": b.get("nextAction"),
        "nextActionDate": b.get("nextActionDate"),
        "notes": b.get("notes"),
    }
    return JSONResponse(store.create_contact(conn, inp), status_code=201)


@router.patch("/{contact_id}")
async def update_contact(
    contact_id: str, request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    if "name" in b and (not isinstance(b["name"], str) or not b["name"].strip()):
        return _err(400, "name must be a non-empty string")
    if "nextActionDate" in b and b["nextActionDate"] is not None and not is_iso_date(
        b["nextActionDate"]
    ):
        return _err(400, f"invalid nextActionDate: {b['nextActionDate']}")
    updated = store.update_contact(conn, contact_id, b)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.delete("/{contact_id}")
def delete_contact(contact_id: str, conn: sqlite3.Connection = Depends(get_db)):
    ok = store.delete_contact(conn, contact_id)
    if not ok:
        return _err(404, "Not found")
    return Response(status_code=204)


# Append an interaction to a contact's log.
@router.post("/{contact_id}/interactions")
async def add_interaction(
    contact_id: str, request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    kind = b.get("kind")
    if not kind or not isinstance(kind, str):
        return _err(400, "kind is required")
    occurred_at = b.get("occurredAt")
    if occurred_at is not None and not is_iso_timestamp(occurred_at):
        return _err(400, f"invalid occurredAt: {occurred_at}")
    updated = store.add_interaction(
        conn,
        contact_id,
        {
            "kind": kind,
            "note": b.get("note"),
            "occurredAt": occurred_at,
            "applicationId": b.get("applicationId"),
        },
    )
    if not updated:
        return _err(404, "Not found")
    return updated


@router.delete("/{contact_id}/interactions/{interaction_id}")
def delete_interaction(
    contact_id: str,
    interaction_id: str,
    conn: sqlite3.Connection = Depends(get_db),
):
    updated = store.delete_interaction(conn, contact_id, interaction_id)
    if not updated:
        return _err(404, "Not found")
    return updated
