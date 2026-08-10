"""Discovery routes — tracked ATS boards and the postings found on them.

Nothing here uses a model. Board polling reads the same public no-auth ATS APIs
the Phase 1 autofill uses, so discovery costs nothing per run.
"""
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .. import discovery as store
from .. import postings
from ..db import get_db

router = APIRouter()


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


# --- Boards ---------------------------------------------------------------


@router.get("/boards")
def list_boards(conn: sqlite3.Connection = Depends(get_db)):
    return store.list_boards(conn)


# Add a board by pasting its careers URL; the ATS, tenant, and site slug are
# derived from it (see postings.parse_board_url).
@router.post("/boards")
async def create_board(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    b = await _body(request)
    url = (b.get("url") or "").strip()
    if not url:
        return _err(400, "A board URL is required.")
    try:
        board = store.create_board(
            conn, url, (b.get("keywords") or ""), (b.get("company") or "")
        )
    except postings.FetchError as e:
        return _err(e.status, e.message)
    return JSONResponse(board, status_code=201)


@router.delete("/boards/{board_id}")
def delete_board(board_id: str, conn: sqlite3.Connection = Depends(get_db)):
    if not store.delete_board(conn, board_id):
        return _err(404, "Not found")
    return JSONResponse(None, status_code=204)


# Poll every active board. Per-board failures are reported but never abort the
# batch, so one dead slug can't stop the rest from ingesting.
@router.post("/boards/refresh")
def refresh_boards(conn: sqlite3.Connection = Depends(get_db)):
    return store.refresh_boards(conn)


# --- The inbox ------------------------------------------------------------


@router.get("/discovered")
def list_discovered(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    return store.list_discovered(conn, request.query_params.get("status") or "new")


@router.post("/discovered/{job_id}/{action}")
def resolve_discovered(
    job_id: str, action: str, conn: sqlite3.Connection = Depends(get_db)
):
    if action not in ("save", "dismiss", "apply"):
        return _err(400, "action must be save, dismiss, or apply")
    job = store.resolve_discovered(conn, job_id, action)
    if not job:
        return _err(404, "Not found")
    return job
