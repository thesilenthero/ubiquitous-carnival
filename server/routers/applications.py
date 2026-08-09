"""Application routes — the port of src/server's routes/applications.ts.

Validation is hand-ported (not Pydantic models) so every check, error message,
and status code matches the Express implementation exactly.
"""
import sqlite3

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .. import repo
from ..db import get_db
from ..domain import is_iso_date, is_iso_timestamp, is_stage
from ..ids import today_str

router = APIRouter()

# Verdict keys produced by the job-evaluation calculator (web/src/lib/evaluation.ts).
VERDICT_KEYS = {"apply", "apply-eyes-open", "marginal", "skip"}


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _num_or_null(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return int(n) if n == int(n) else n


def _is_non_empty_string(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


@router.get("")
def list_applications(conn: sqlite3.Connection = Depends(get_db)):
    return repo.list_applications(conn)


@router.get("/{app_id}")
def get_application(app_id: str, conn: sqlite3.Connection = Depends(get_db)):
    app = repo.get_application(conn, app_id)
    if not app:
        return _err(404, "Not found")
    return app


@router.post("")
async def create_application(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    if not b.get("company") or not b.get("roleTitle"):
        return _err(400, "company and roleTitle are required")
    if b.get("source") is not None and not _is_non_empty_string(b["source"]):
        return _err(400, "source must be a non-empty string")
    if b.get("dateApplied") and not is_iso_date(b["dateApplied"]):
        return _err(400, f"invalid dateApplied: {b['dateApplied']}")
    if b.get("nextActionDate") and not is_iso_date(b["nextActionDate"]):
        return _err(400, f"invalid nextActionDate: {b['nextActionDate']}")
    eval_composite = _num_or_null(b.get("evalComposite"))
    if eval_composite is not None and not (0 <= eval_composite <= 100):
        return _err(400, "evalComposite must be between 0 and 100")
    eval_verdict = b.get("evalVerdict")
    if eval_verdict is not None and eval_verdict not in VERDICT_KEYS:
        return _err(400, f"invalid evalVerdict: {eval_verdict}")
    evaluation = b.get("evaluation")
    if evaluation is not None and not isinstance(evaluation, dict):
        return _err(400, "evaluation must be an object")
    inp = {
        "company": str(b["company"]),
        "roleTitle": str(b["roleTitle"]),
        "source": b.get("source"),
        "dateApplied": b.get("dateApplied") or today_str(),
        "location": b.get("location"),
        "remote": bool(b.get("remote")),
        "salaryMin": _num_or_null(b.get("salaryMin")),
        "salaryMax": _num_or_null(b.get("salaryMax")),
        "contactName": b.get("contactName"),
        "referralSource": b.get("referralSource"),
        "industry": b.get("industry"),
        "roleType": b.get("roleType"),
        "jobUrl": b.get("jobUrl"),
        "jobDescription": b.get("jobDescription"),
        "resumeText": b.get("resumeText"),
        "notes": b.get("notes"),
        "nextAction": b.get("nextAction"),
        "nextActionDate": b.get("nextActionDate"),
        "evalComposite": eval_composite,
        "evalVerdict": eval_verdict,
        "evaluation": evaluation,
    }
    return JSONResponse(repo.create_application(conn, inp), status_code=201)


@router.patch("/{app_id}")
async def update_application(
    app_id: str, request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    if b.get("source") is not None and not _is_non_empty_string(b["source"]):
        return _err(400, "source must be a non-empty string")
    if "dateApplied" in b and not is_iso_date(b["dateApplied"]):
        return _err(400, f"invalid dateApplied: {b['dateApplied']}")
    if "nextActionDate" in b and b["nextActionDate"] is not None and not is_iso_date(
        b["nextActionDate"]
    ):
        return _err(400, f"invalid nextActionDate: {b['nextActionDate']}")
    if "salaryMin" in b:
        b["salaryMin"] = _num_or_null(b["salaryMin"])
    if "salaryMax" in b:
        b["salaryMax"] = _num_or_null(b["salaryMax"])
    updated = repo.update_application(conn, app_id, b)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.post("/{app_id}/stage")
async def add_stage_event(
    app_id: str, request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    stage, note, occurred_at = b.get("stage"), b.get("note"), b.get("occurredAt")
    if not is_stage(stage):
        return _err(400, f"invalid stage: {stage}")
    if occurred_at is not None and not is_iso_timestamp(occurred_at):
        return _err(400, f"invalid occurredAt: {occurred_at}")
    updated = repo.add_stage_event(conn, app_id, stage, note, occurred_at)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.patch("/{app_id}/stage/{event_id}")
async def update_stage_event(
    app_id: str,
    event_id: str,
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    b = await _body(request)
    if "stage" in b and not is_stage(b["stage"]):
        return _err(400, f"invalid stage: {b['stage']}")
    if "occurredAt" in b and not is_iso_timestamp(b["occurredAt"]):
        return _err(400, f"invalid occurredAt: {b['occurredAt']}")
    patch = {k: b[k] for k in ("stage", "note", "occurredAt") if k in b}
    updated = repo.update_stage_event(conn, app_id, event_id, patch)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.delete("/{app_id}/stage/{event_id}")
def delete_stage_event(
    app_id: str, event_id: str, conn: sqlite3.Connection = Depends(get_db)
):
    updated = repo.delete_stage_event(conn, app_id, event_id)
    if not updated:
        return _err(404, "Not found")
    return updated


# Interview rounds. Stubs are auto-created when an interview-type stage event
# is recorded; these routes add extra rounds and fill in / correct records.
@router.post("/{app_id}/interviews")
async def add_interview(
    app_id: str, request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    if b.get("date") is not None and not is_iso_date(b["date"]):
        return _err(400, f"invalid date: {b['date']}")
    updated = repo.add_interview(
        conn,
        app_id,
        {k: b.get(k) for k in ("date", "format", "interviewers", "questions", "notes")},
    )
    if not updated:
        return _err(404, "Not found")
    return JSONResponse(updated, status_code=201)


@router.patch("/{app_id}/interviews/{interview_id}")
async def update_interview(
    app_id: str,
    interview_id: str,
    request: Request,
    conn: sqlite3.Connection = Depends(get_db),
):
    b = await _body(request)
    if "date" in b and b["date"] is not None and not is_iso_date(b["date"]):
        return _err(400, f"invalid date: {b['date']}")
    updated = repo.update_interview(conn, app_id, interview_id, b)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.delete("/{app_id}/interviews/{interview_id}")
def delete_interview(
    app_id: str, interview_id: str, conn: sqlite3.Connection = Depends(get_db)
):
    updated = repo.delete_interview(conn, app_id, interview_id)
    if not updated:
        return _err(404, "Not found")
    return updated


# Hard delete is intentionally available but the UI defaults to archiving.
@router.delete("/{app_id}")
def delete_application(app_id: str, conn: sqlite3.Connection = Depends(get_db)):
    ok = repo.delete_application(conn, app_id)
    if not ok:
        return _err(404, "Not found")
    return Response(status_code=204)
