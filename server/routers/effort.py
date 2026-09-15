"""Effort-log routes.

The only hand-written half of the effort score. Everything else it counts is
already in the tracker — these entries are for the work that isn't: prep, a
take-home, an hour of practice. The score itself is not served here; it rides
along on GET /api/analytics under `effort`, so the page fetches it once.
"""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from ..db import get_db
from ..domain import EFFORT_KINDS, is_iso_date
from ..effort import create_entry, delete_entry, list_entries

router = APIRouter()


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


@router.get("/effort")
def get_effort(
    # `from` is a Python keyword, so the query name comes from the alias — the
    # URL still reads ?from=&to= like the analytics and activity routes.
    frm: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    applicationId: Optional[str] = None,
    limit: int = 100,
    conn: sqlite3.Connection = Depends(get_db),
):
    for name, value in (("from", frm), ("to", to)):
        if value and not is_iso_date(value):
            return _err(400, f"invalid {name}: {value}")
    return list_entries(
        conn, frm=frm, to=to, application_id=applicationId, limit=limit
    )


@router.post("/effort")
async def post_effort(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    entry = create_entry(conn, await _body(request))
    if entry is None:
        return _err(
            400,
            "kind must be one of " + ", ".join(EFFORT_KINDS)
            + ", and occurredAt must be a YYYY-MM-DD date",
        )
    return entry


@router.delete("/effort/{entry_id}")
def remove_effort(entry_id: str, conn: sqlite3.Connection = Depends(get_db)):
    if not delete_entry(conn, entry_id):
        return _err(404, "not found")
    return {"ok": True}
