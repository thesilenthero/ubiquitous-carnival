"""Suggestion routes — the port of src/server's routes/suggestions.ts."""
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .. import suggestions as store
from ..db import get_db
from ..domain import is_iso_timestamp, is_stage

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
def list_pending(conn: sqlite3.Connection = Depends(get_db)):
    return store.list_pending_suggestions(conn)


# Create a suggestion — the write path for external scanners (e.g. Claude
# reading Gmail). Deduplicates against pending suggestions so re-scans are
# idempotent. Never touches the stage log itself.
@router.post("")
async def create_suggestion(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    if not b.get("applicationId") or not is_stage(b.get("suggestedStage")):
        return _err(400, "applicationId and a valid suggestedStage are required")
    if b.get("occurredAt") is not None and not is_iso_timestamp(b["occurredAt"]):
        return _err(400, f"invalid occurredAt: {b['occurredAt']}")
    s = store.create_suggestion(
        conn,
        {
            "applicationId": str(b["applicationId"]),
            "suggestedStage": b["suggestedStage"],
            "evidence": b.get("evidence"),
            "source": b.get("source"),
            "occurredAt": b.get("occurredAt"),
        },
    )
    if s is None:
        return _err(404, "application not found")
    if s == "already-recorded":
        return _err(409, "that stage is already in the application's log")
    return JSONResponse(s, status_code=201)


@router.post("/{sid}/accept")
def accept(sid: str, conn: sqlite3.Connection = Depends(get_db)):
    s = store.accept_suggestion(conn, sid)
    if not s:
        return _err(404, "Not found")
    return s


@router.post("/{sid}/dismiss")
def dismiss(sid: str, conn: sqlite3.Connection = Depends(get_db)):
    s = store.dismiss_suggestion(conn, sid)
    if not s:
        return _err(404, "Not found")
    return s
