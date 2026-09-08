"""Next-step routes — the computed "what should I do now" queue.

Read-only apart from a snooze. Acting on a play goes through the existing
application/contact routes, because the act *is* an ordinary edit: writing a
next action, or recording a stage.
"""
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..db import get_db
from ..next_steps import SNOOZE_DAYS, compute_next_steps, snooze

router = APIRouter()


@router.get("/next-steps")
def list_next_steps(conn: sqlite3.Connection = Depends(get_db)):
    return compute_next_steps(conn)


@router.post("/next-steps/snooze")
async def snooze_step(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    try:
        b = await request.json()
    except Exception:
        b = {}
    step_id = b.get("id") if isinstance(b, dict) else None
    if not step_id or not isinstance(step_id, str):
        return JSONResponse({"error": "id is required"}, status_code=400)
    days = b.get("days", SNOOZE_DAYS)
    if not isinstance(days, (int, float)) or not 1 <= days <= 365:
        days = SNOOZE_DAYS
    return snooze(conn, step_id, int(days))
