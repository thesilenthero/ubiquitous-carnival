"""Application routes — the port of src/server's routes/applications.ts.

Validation is hand-ported (not Pydantic models) so every check, error message,
and status code matches the Express implementation exactly.
"""
import sqlite3

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from fastapi.responses import JSONResponse

from .. import attachment_files, repo
from ..db import get_db
from ..domain import (
    is_iso_date,
    is_iso_timestamp,
    is_salary_period,
    is_stage,
    is_work_mode,
)
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


def _contact_exists(conn: sqlite3.Connection, contact_id: object) -> bool:
    if not isinstance(contact_id, str):
        return False
    row = conn.execute(
        "SELECT 1 FROM contacts WHERE id = ?", (contact_id,)
    ).fetchone()
    return row is not None


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
    # Which stage the seed event records. Defaults to `applied`; sending
    # `interested` creates the row on the docket instead of in the funnel.
    initial_stage = b.get("initialStage")
    if initial_stage is not None and not is_stage(initial_stage):
        return _err(400, f"invalid initialStage: {initial_stage}")
    work_mode = b.get("workMode")
    if work_mode is not None and not is_work_mode(work_mode):
        return _err(400, f"invalid workMode: {work_mode}")
    salary_period = b.get("salaryPeriod")
    if salary_period is not None and not is_salary_period(salary_period):
        return _err(400, f"invalid salaryPeriod: {salary_period}")
    contact_id = b.get("contactId")
    if contact_id is not None and not _contact_exists(conn, contact_id):
        return _err(400, f"unknown contactId: {contact_id}")
    inp = {
        "company": str(b["company"]),
        "roleTitle": str(b["roleTitle"]),
        "source": b.get("source"),
        "dateApplied": b.get("dateApplied") or today_str(),
        "location": b.get("location"),
        "workMode": work_mode,
        "salaryMin": _num_or_null(b.get("salaryMin")),
        "salaryMax": _num_or_null(b.get("salaryMax")),
        "salaryPeriod": salary_period,
        "contactName": b.get("contactName"),
        "contactId": contact_id,
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
        "initialStage": initial_stage,
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
    if "workMode" in b and not is_work_mode(b["workMode"]):
        return _err(400, f"invalid workMode: {b['workMode']}")
    if "salaryPeriod" in b and not is_salary_period(b["salaryPeriod"]):
        return _err(400, f"invalid salaryPeriod: {b['salaryPeriod']}")
    # Clearing the link is allowed (the referrer isn't in your contacts, or
    # never was one); pointing it at a contact that doesn't exist is not.
    if (
        b.get("contactId") is not None
        and not _contact_exists(conn, b["contactId"])
    ):
        return _err(400, f"unknown contactId: {b['contactId']}")
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
        {k: b.get(k) for k in ("date", "format", "interviewers", "notes")},
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


# --- PDF attachments ------------------------------------------------------
#
# The only multipart routes in the codebase; everything else reads raw JSON.
# The PDFs themselves live on disk (server/attachment_files.py), not in the
# database. `kind` is "resume" or "cover-letter" and is resolved through the
# frozen table in attachment_files before it is used for anything.

# The camelCase response key holding the original upload name, per kind. The
# Kind table carries the snake_case column; this is its _map_app counterpart.
_FILENAME_KEY = {"resume": "resumeFilename", "cover-letter": "coverLetterFilename"}


async def _upload(kind_key: str, app_id: str, file: UploadFile, conn: sqlite3.Connection):
    """Attach a PDF, replacing any existing one of that kind, and archive its text."""
    kind = attachment_files.by_key(kind_key)
    if not kind:
        return _err(404, "Not found")
    app = repo.get_application(conn, app_id)
    if not app:
        return _err(404, "Not found")

    data = await file.read()
    if not data:
        return _err(400, "That file is empty.")
    if len(data) > attachment_files.MAX_BYTES:
        mb = attachment_files.MAX_BYTES // (1024 * 1024)
        return _err(413, f"That file is larger than {mb}MB.")
    if not attachment_files.looks_like_pdf(data, file.filename or ""):
        return _err(400, "Only PDF files can be attached.")

    stored_name, size = attachment_files.save(kind, app, data)
    updated = repo.set_attachment(
        conn,
        app_id,
        kind,
        stored_name,
        (file.filename or kind.default_name),
        size,
        attachment_files.extract_text(data),
    )
    if not updated:
        # The row vanished between the lookup and the write; don't leave the
        # file behind for nothing.
        attachment_files.delete(kind, stored_name)
        return _err(404, "Not found")
    return updated


def _download(kind_key: str, app_id: str, conn: sqlite3.Connection):
    kind = attachment_files.by_key(kind_key)
    if not kind:
        return _err(404, "Not found")
    app = repo.get_application(conn, app_id)
    if not app:
        return _err(404, "Not found")
    stored = repo.get_attachment_path(conn, app_id, kind)
    if not stored:
        return _err(404, f"No {kind.label} is attached to this application.")
    try:
        content = attachment_files.read(kind, stored)
    except (ValueError, OSError):
        # Recorded in the database but unreadable on disk — say so plainly
        # rather than serving a 500.
        return _err(410, f"The stored {kind.label} file is missing.")
    filename = app.get(_FILENAME_KEY[kind.key]) or kind.default_name
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _detach(kind_key: str, app_id: str, conn: sqlite3.Connection):
    kind = attachment_files.by_key(kind_key)
    if not kind:
        return _err(404, "Not found")
    updated = repo.clear_attachment(conn, app_id, kind)
    if not updated:
        return _err(404, "Not found")
    return updated


@router.post("/{app_id}/attachments/{kind}")
async def upload_attachment(
    app_id: str,
    kind: str,
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_db),
):
    return await _upload(kind, app_id, file, conn)


@router.get("/{app_id}/attachments/{kind}")
def download_attachment(
    app_id: str, kind: str, conn: sqlite3.Connection = Depends(get_db)
):
    return _download(kind, app_id, conn)


@router.delete("/{app_id}/attachments/{kind}")
def delete_attachment(
    app_id: str, kind: str, conn: sqlite3.Connection = Depends(get_db)
):
    return _detach(kind, app_id, conn)


# The original resume-only paths, kept so links handed out before attachments
# were generalized (and the ones in the README) keep working.


@router.post("/{app_id}/resume")
async def upload_resume(
    app_id: str,
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_db),
):
    return await _upload("resume", app_id, file, conn)


@router.get("/{app_id}/resume")
def download_resume(app_id: str, conn: sqlite3.Connection = Depends(get_db)):
    return _download("resume", app_id, conn)


@router.delete("/{app_id}/resume")
def delete_resume(app_id: str, conn: sqlite3.Connection = Depends(get_db)):
    return _detach("resume", app_id, conn)
