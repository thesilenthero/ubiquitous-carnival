"""Mirrors the tracker into a real multi-tab Google Sheet.

The CSV mirror (server/csv_backup.py) already keeps a readable copy of the data
in a synced folder, but a CSV sitting in Drive is a file to download, not a
spreadsheet: you can't pivot it, chart it, or open it on a phone as a sheet.
This module keeps an actual Sheets document current instead — one tab per entry
in `csv_io.EXPORT_FILES`, refreshed by the same trigger that drives the CSVs.

The two mirrors are independent; either can be on without the other.

Content comes from `EXPORT_FILES` and is not reshaped here, so the tabs hold
exactly what `/api/export.zip` and the synced CSVs hold. Only the destination
differs. Rows arrive as strings and go up as USER_ENTERED, so Sheets re-types
numbers and dates on the way in — which is what makes the tabs pivotable rather
than 23 columns of text.

The synced tabs are overwritten wholesale on every push: this is a mirror of the
database, not a place to edit. Tabs you add yourself are never touched, so
pivots and charts built on top of the synced tabs are safe.

Setup is three env vars away — see "The Google Sheet" in README.md.
"""
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from .csv_io import EXPORT_FILES, parse_csv
from .db import connect
from .ids import now_iso

log = logging.getLogger(__name__)

# The spreadsheet to write into: the long id out of its URL,
# docs.google.com/spreadsheets/d/<this>/edit. Unset means the Sheet mirror is
# off, which is the default — nothing here runs until you point it somewhere.
SHEET_ID: Optional[str] = os.environ.get("GOOGLE_SHEET_ID") or None

# Service-account JSON key. A service account rather than OAuth because this
# writes from a background thread: no browser consent, nothing to re-authorize
# six months from now. The Sheet stays in your Drive — you share it with the
# service account's email, so the robot is a guest, not the owner.
_creds_env = os.environ.get(
    "GOOGLE_SHEETS_CREDENTIALS", "~/.config/job-tracker/google-service-account.json"
)
CREDENTIALS_PATH: Optional[Path] = (
    Path(_creds_env).expanduser() if _creds_env else None
)

# One tab per EXPORT_FILES entry. These are display names, so unlike the CSV
# filenames they don't need a job- prefix — the spreadsheet is the namespace.
SHEET_TABS = {
    "applications.csv": "Applications",
    "stage-events.csv": "Stage events",
    "interviews.csv": "Interviews",
    "interactions.csv": "Interactions",
    "activity.csv": "Activity",
}

# A push is two API calls against a 60-per-minute quota, so this is slack, not a
# real ceiling. It exists so a long drag across the board — which the 2s debounce
# can still turn into several pushes — can't walk us toward the limit.
MIN_PUSH_INTERVAL = 15.0

# Sheets rejects the whole request if any single cell exceeds 50k characters,
# and job_description and resume_text can be long. Truncating one cell is much
# better than losing the sync.
MAX_CELL_CHARS = 50000

_push_lock = threading.Lock()
_service = None
_tabs_ensured = False
_last_payload_hash: Optional[str] = None
_last_push_at: float = 0.0
_last_synced_at: Optional[str] = None
_last_error: Optional[str] = None
_warned_failure = False


def is_configured() -> bool:
    """True when there is somewhere to write and something to authenticate with."""
    return bool(SHEET_ID) and CREDENTIALS_PATH is not None and CREDENTIALS_PATH.is_file()


def sheet_url() -> Optional[str]:
    if not SHEET_ID:
        return None
    return f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"


def status() -> dict:
    """What the UI needs to decide whether to show the card, and what to say."""
    configured = is_configured()
    detail = _last_error
    if not configured and detail is None:
        if not SHEET_ID:
            detail = "Set GOOGLE_SHEET_ID to mirror into a Google Sheet."
        else:
            detail = f"No service-account key at {CREDENTIALS_PATH}."
    return {
        "configured": configured,
        "sheetUrl": sheet_url(),
        "lastSyncedAt": _last_synced_at,
        "lastError": detail,
    }


def _get_service():
    global _service
    if _service is None:
        # Imported lazily, like the anthropic client in server/ai.py: someone
        # who never turns this on shouldn't need the packages installed.
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
        except ImportError as e:
            raise RuntimeError(
                "Google Sheets sync needs: "
                "pip3 install google-api-python-client google-auth"
            ) from e

        creds = service_account.Credentials.from_service_account_file(
            str(CREDENTIALS_PATH),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        # cache_discovery=False: the on-disk discovery cache warns under any
        # non-oauth2client setup and buys us nothing for one API.
        _service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return _service


def _safe_cell(value: str) -> str:
    """Keep a text cell text.

    USER_ENTERED parses input the way typing does, which is the point — it's how
    a salary becomes a number you can sum. But it also means a note starting
    with "=" would become a formula and a "+1 (555)…" phone number an error.
    Leading apostrophe is the Sheets escape for "this is literally text".
    """
    if len(value) > MAX_CELL_CHARS:
        value = value[: MAX_CELL_CHARS - 1] + "…"
    if not value:
        return value
    first = value[0]
    if first in "=+@":
        return "'" + value
    if first == "-":
        # A negative number is fine; "-- see notes" is not.
        try:
            float(value)
        except ValueError:
            return "'" + value
    return value


def _error_text(e: Exception) -> str:
    """A failure someone can act on, out of whatever the Google libs raised.

    Their exceptions stringify to tuple reprs and multi-line JSON bodies, which
    read as noise in a status card. Pull out the sentence, and translate the one
    failure everybody hits at setup: the key is valid, so auth succeeds, but
    nobody shared the spreadsheet with the service account, so the first call
    404s or 403s.
    """
    reason = getattr(e, "reason", None)
    if isinstance(reason, str) and reason.strip():
        text = reason.strip()
    elif e.args and isinstance(e.args[0], str):
        text = e.args[0].strip()
    else:
        text = str(e).strip()

    status = getattr(getattr(e, "resp", None), "status", None)
    if status in (403, 404):
        text += (
            f" — check the Sheet is shared with the service account "
            f"as an Editor, and that GOOGLE_SHEET_ID is right."
        )

    return text[:400]


def build_payload(conn: sqlite3.Connection) -> dict[str, list[list[str]]]:
    """{tab name: rows}, straight off the same builders the CSVs use.

    Round-tripping the CSV text through parse_csv rather than reaching into the
    builders keeps csv_io.EXPORT_FILES the one definition of what the export is:
    whatever lands in the zip lands here, including columns added later.
    """
    payload = {}
    for name, build in EXPORT_FILES.items():
        rows = parse_csv(build(conn))
        payload[SHEET_TABS[name]] = [[_safe_cell(c) for c in row] for row in rows]
    return payload


def _ensure_tabs(service, tabs: list[str]) -> None:
    """Create any missing tab, once per process. Existing tabs are left alone —
    including ones we don't know about, like the default Sheet1 or your own."""
    global _tabs_ensured
    if _tabs_ensured:
        return

    meta = service.spreadsheets().get(
        spreadsheetId=SHEET_ID, fields="sheets.properties"
    ).execute()
    existing = {s["properties"]["title"] for s in meta.get("sheets", [])}
    missing = [t for t in tabs if t not in existing]

    if missing:
        result = service.spreadsheets().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={
                "requests": [
                    {
                        "addSheet": {
                            "properties": {
                                "title": title,
                                # Freeze at creation so the header stays put the
                                # first time you scroll, not the second.
                                "gridProperties": {"frozenRowCount": 1},
                            }
                        }
                    }
                    for title in missing
                ]
            },
        ).execute()

        # Bold the header row. Needs the sheetIds, which only exist once the
        # tabs do, hence the second call — first run only.
        new_ids = [
            r["addSheet"]["properties"]["sheetId"] for r in result.get("replies", [])
        ]
        if new_ids:
            service.spreadsheets().batchUpdate(
                spreadsheetId=SHEET_ID,
                body={
                    "requests": [
                        {
                            "repeatCell": {
                                "range": {
                                    "sheetId": sid,
                                    "startRowIndex": 0,
                                    "endRowIndex": 1,
                                },
                                "cell": {
                                    "userEnteredFormat": {
                                        "textFormat": {"bold": True}
                                    }
                                },
                                "fields": "userEnteredFormat.textFormat.bold",
                            }
                        }
                        for sid in new_ids
                    ]
                },
            ).execute()

    _tabs_ensured = True


def write_export(
    conn: Optional[sqlite3.Connection] = None, *, throttle: bool = True
) -> bool:
    """Push the current data to the Sheet. Returns True if anything was written.

    Never raises, for the same reason csv_backup.write_export doesn't: this runs
    off the back of a request that already succeeded, and a backup that couldn't
    be written is not a reason to tell someone their edit failed. The failure
    goes to the log and to `status()`, where the UI can show it.

    `throttle=False` skips the rate floor — for the manual "Sync now" button,
    where a request blocking for fifteen seconds would look like a hang.
    """
    global _last_payload_hash, _last_push_at, _last_synced_at, _last_error
    global _warned_failure

    if not is_configured():
        return False

    try:
        # Waited out before taking the lock, not while holding it: otherwise a
        # background push pacing itself would block the "Sync now" button behind
        # it for the same fifteen seconds throttle=False exists to skip.
        if throttle:
            wait = MIN_PUSH_INTERVAL - (time.monotonic() - _last_push_at)
            if wait > 0:
                time.sleep(wait)

        with _push_lock:
            own_conn = conn is None
            conn = conn or connect()
            try:
                payload = build_payload(conn)
            finally:
                if own_conn:
                    conn.close()

            # A push is a network round trip and a slice of quota; don't spend
            # either on data that hasn't moved. This is what makes the read-only
            # AI POSTs free and scripts/export_sheets.py safe to schedule — the
            # same bargain _write_one strikes for the CSVs.
            digest = hashlib.sha256(
                json.dumps(payload, sort_keys=True).encode("utf-8")
            ).hexdigest()
            if digest == _last_payload_hash:
                return False

            service = _get_service()
            _ensure_tabs(service, list(payload))

            # Clear before writing: an update only overwrites the cells it
            # covers, so without this a deleted application would leave its row
            # behind as a phantom below the new last row.
            service.spreadsheets().values().batchClear(
                spreadsheetId=SHEET_ID,
                body={"ranges": [f"'{tab}'" for tab in payload]},
            ).execute()

            service.spreadsheets().values().batchUpdate(
                spreadsheetId=SHEET_ID,
                body={
                    "valueInputOption": "USER_ENTERED",
                    "data": [
                        {"range": f"'{tab}'!A1", "values": rows}
                        for tab, rows in payload.items()
                    ],
                },
            ).execute()

            _last_payload_hash = digest
            _last_push_at = time.monotonic()
            _last_synced_at = now_iso()
            _last_error = None
            _warned_failure = False
            return True
    except Exception as e:
        # The tabs may be half-created, and the payload certainly isn't up
        # there — forget both so the next attempt is a full retry, not a skip.
        _tabs_ensured_reset()
        _last_payload_hash = None
        _last_error = _error_text(e)
        # One broken Sheet is one warning, not one per edit: a mirror that stays
        # broken would otherwise fill the log while you work. status() still
        # carries the message, and a success re-arms this.
        if not _warned_failure:
            log.warning("Google Sheet mirror to %s failed", SHEET_ID, exc_info=True)
            _warned_failure = True
        return False


def _tabs_ensured_reset() -> None:
    global _tabs_ensured, _service
    _tabs_ensured = False
    _service = None
