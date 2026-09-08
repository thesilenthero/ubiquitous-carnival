"""Analytics, settings, CSV export, Google Sheet status, and migration import —
the port of src/server's routes/data.ts."""
import datetime as dt
import io
import sqlite3
import zipfile

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from ..activity import using_source
from ..analytics import compute_analytics
from ..csv_io import EXPORT_FILES, export_csv, parse_csv
from ..db import get_db
from ..domain import (
    DEFAULT_SALARY_PERIOD,
    DEFAULT_WORK_MODE,
    FALLBACK_SOURCE,
    is_iso_date,
    is_salary_period,
    is_stage,
    is_work_mode,
    normalize_source,
)
from ..repo import create_application
from ..settings_store import NUMERIC_SETTINGS, get_settings, update_settings
from ..sheets_sync import (
    is_configured as sheets_configured,
    status as sheets_status,
    write_export as sheets_write,
)

router = APIRouter()


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


# Live analytics — recomputed from the event log on every request. Accepts an
# optional ?from=YYYY-MM-DD&to=YYYY-MM-DD window on date applied.
@router.get("/analytics")
def analytics(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    rng = {}
    for key in ("from", "to"):
        v = request.query_params.get(key)
        if v is None:
            continue
        if not is_iso_date(v):
            return _err(400, f"invalid {key} date: {v}")
        rng[key] = v
    return compute_analytics(conn, rng.get("from"), rng.get("to"))


@router.get("/settings")
def read_settings(conn: sqlite3.Connection = Depends(get_db)):
    return get_settings(conn)


@router.patch("/settings")
async def patch_settings(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
):
    b = await _body(request)
    for key, (_default, lo, hi) in NUMERIC_SETTINGS.items():
        if key in b and b[key] is not None:
            try:
                n = float(b[key])
            except (TypeError, ValueError):
                n = float("nan")
            if not (n == n and lo <= n <= hi):
                return _err(
                    400, f"{key} must be a number between {int(lo)} and {int(hi)}"
                )
            b[key] = int(n) if n == int(n) else n
    return update_settings(conn, b)


def _stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def _download(content, media_type: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# The applications sheet on its own. Superseded by /export.zip as the thing the
# sidebar links to, but kept: it is what the Drive mirror writes, and it is the
# file anyone with the old link or a bookmark is expecting.
@router.get("/export.csv")
def export(conn: sqlite3.Connection = Depends(get_db)):
    return _download(
        export_csv(conn),
        "text/csv; charset=utf-8",
        f"job-applications-{_stamp()}.csv",
    )


# The whole tracker: applications plus the stage log, interviews, and
# engagements that hang off them. Escape hatch against lock-in and migration
# safety net. Built in memory — a few hundred KB of CSV, not a data warehouse.
@router.get("/export.zip")
def export_zip(conn: sqlite3.Connection = Depends(get_db)):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, build in EXPORT_FILES.items():
            z.writestr(name, build(conn))
    return _download(
        buf.getvalue(), "application/zip", f"job-tracker-{_stamp()}.zip"
    )


# Migration import. Expects { csv: string, mapping: { <schemaField>: <header> } }.
# For historical rows only the current stage is known, so we seed the event log
# with a single event at the applied date (timing of intermediate stages is
# unknown — a documented caveat of the migration).
@router.post("/import")
async def import_csv(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    b = await _body(request)
    csv_text, mapping = b.get("csv"), b.get("mapping")
    if not isinstance(csv_text, str) or not isinstance(mapping, dict):
        return _err(400, "csv and mapping are required")
    rows = parse_csv(csv_text)
    if len(rows) < 2:
        return {"imported": 0, "errors": []}

    header = [h.strip() for h in rows[0]]

    def cell(row: list[str], field: str):
        col = mapping.get(field)
        if not col or col not in header:
            return None
        i = header.index(col)
        return row[i].strip() if i < len(row) and row[i] is not None else None

    def to_num(v):
        if not v:
            return None
        digits = "".join(ch for ch in v if ch.isdigit() or ch == ".")
        try:
            n = float(digits)
        except ValueError:
            return None
        if n > 0:
            return int(n) if n == int(n) else n
        return None

    imported = 0
    errors: list[str] = []
    for r in range(1, len(rows)):
        row = rows[r]
        company = cell(row, "company")
        role_title = cell(row, "roleTitle")
        if not company or not role_title:
            errors.append(f"Row {r + 1}: missing company or role title")
            continue
        source = normalize_source(cell(row, "source")) or FALLBACK_SOURCE
        raw_stage = cell(row, "currentStage")
        stage = raw_stage if is_stage(raw_stage) else "applied"
        date_applied = cell(row, "dateApplied") or dt.datetime.now(
            dt.timezone.utc
        ).date().isoformat()
        # An unmapped or unrecognized column falls back to the default rather
        # than failing the row — the same forgiving treatment `source` gets.
        raw_mode = cell(row, "workMode").strip().lower().replace("-", "")
        work_mode = raw_mode if is_work_mode(raw_mode) else DEFAULT_WORK_MODE
        raw_period = cell(row, "salaryPeriod").strip().lower()
        salary_period = (
            raw_period if is_salary_period(raw_period) else DEFAULT_SALARY_PERIOD
        )
        try:
            # Tagged as an import: a CSV of 80 rows lands in one second and is
            # not 80 things you did today.
            with using_source("import"):
                create_application(
                    conn,
                    {
                        "company": company,
                        "roleTitle": role_title,
                        "source": source,
                        "dateApplied": date_applied,
                        "location": cell(row, "location") or None,
                        "workMode": work_mode,
                        "salaryMin": to_num(cell(row, "salaryMin")),
                        "salaryMax": to_num(cell(row, "salaryMax")),
                        "salaryPeriod": salary_period,
                        "contactName": cell(row, "contactName") or None,
                        "notes": cell(row, "notes") or None,
                        "initialStage": stage,
                        "initialStageAt": f"{date_applied}T00:00:00.000Z",
                    },
                )
            imported += 1
        except Exception as e:  # keep importing the rest, matching the TS route
            errors.append(f"Row {r + 1}: {e}")
    return {"imported": imported, "errors": errors}


# Lets the UI hide the Sheet card rather than showing a control that 400s, and
# surfaces the last failure — a mirror that has quietly stopped working is
# exactly the thing you want to find out about before you need the backup.
@router.get("/sheets/status")
def sheets_status_route():
    return sheets_status()


# Push now, rather than waiting for the next change to trigger the mirror. The
# one case that needs it: edits the server never saw (a direct sqlite3 write, an
# import script), where nothing is coming to trigger it.
@router.post("/sheets/sync")
def sheets_sync_route(conn: sqlite3.Connection = Depends(get_db)):
    if not sheets_configured():
        return _err(400, "Google Sheet sync is not configured.")
    # throttle=False: the rate floor exists to pace the background thread. A
    # person waiting on a button should not sit through it.
    synced = sheets_write(conn, throttle=False)
    return {"synced": synced, **sheets_status()}


@router.get("/health")
def health():
    return {"ok": True}
