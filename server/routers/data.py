"""Analytics, settings, CSV export, and migration import — the port of
src/server's routes/data.ts."""
import datetime as dt
import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from ..analytics import compute_analytics
from ..csv_io import export_csv, parse_csv
from ..db import get_db
from ..domain import is_iso_date, is_stage
from ..repo import create_application
from ..settings_store import NUMERIC_SETTINGS, get_settings, update_settings

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


# Full CSV export: escape hatch against lock-in and migration safety net.
@router.get("/export.csv")
def export(conn: sqlite3.Connection = Depends(get_db)):
    filename = f"job-applications-{dt.datetime.now(dt.timezone.utc).date().isoformat()}.csv"
    return Response(
        content=export_csv(conn),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
        source = cell(row, "source") or "other"
        raw_stage = cell(row, "currentStage")
        stage = raw_stage if is_stage(raw_stage) else "applied"
        date_applied = cell(row, "dateApplied") or dt.datetime.now(
            dt.timezone.utc
        ).date().isoformat()
        try:
            create_application(
                conn,
                {
                    "company": company,
                    "roleTitle": role_title,
                    "source": source,
                    "dateApplied": date_applied,
                    "location": cell(row, "location") or None,
                    "salaryMin": to_num(cell(row, "salaryMin")),
                    "salaryMax": to_num(cell(row, "salaryMax")),
                    "contactName": cell(row, "contactName") or None,
                    "referralSource": cell(row, "referralSource") or None,
                    "notes": cell(row, "notes") or None,
                    "initialStage": stage,
                    "initialStageAt": f"{date_applied}T00:00:00.000Z",
                },
            )
            imported += 1
        except Exception as e:  # keep importing the rest, matching the TS route
            errors.append(f"Row {r + 1}: {e}")
    return {"imported": imported, "errors": errors}


@router.get("/health")
def health():
    return {"ok": True}
