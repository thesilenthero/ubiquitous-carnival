"""Schedules the backup mirrors: one debounce, two destinations.

There are two copies of the data kept current outside the database — the synced
CSVs (server/csv_backup.py) and the Google Sheet (server/sheets_sync.py). Both
want to refresh after the same thing: a change the server just served. This
module owns that timing so neither has to, and so a burst of edits costs one
refresh rather than one per edit per mirror.

Keeping the scheduling here rather than inside csv_backup is what lets the two
be independent: with the thread living in the CSV mirror, turning the CSVs off
with CSV_EXPORT_DIR="" would have silently taken the Sheet down with it.

Triggered from the middleware in server/main.py, which fires after every
successful non-GET /api request.
"""
import logging
import threading
import time
from typing import Optional

from . import csv_backup, sheets_sync
from .db import connect

log = logging.getLogger(__name__)

# Long enough to swallow a burst — a drag across the board, a CSV import — into
# one refresh, short enough that the copies are current by the time you look.
DEBOUNCE_SECONDS = 2.0

_wake = threading.Event()
_worker_lock = threading.Lock()
_worker: Optional[threading.Thread] = None


def _enabled() -> bool:
    return csv_backup.EXPORT_DIR is not None or sheets_sync.is_configured()


def write_all(conn=None) -> bool:
    """Refresh every configured mirror. Returns True if any wrote something.

    One connection for both: the exports are a dozen read-only queries and
    there's no reason to open the database twice for them. Neither writer
    raises, so one failing mirror can't stop the other.
    """
    own_conn = conn is None
    conn = conn or connect()
    try:
        changed = csv_backup.write_export(conn)
        changed |= sheets_sync.write_export(conn)
        return changed
    finally:
        if own_conn:
            conn.close()


def _run() -> None:
    while True:
        _wake.wait()
        # Wait out the burst: every new request re-arms the flag, and we only
        # refresh once the changes have stopped arriving.
        while True:
            _wake.clear()
            time.sleep(DEBOUNCE_SECONDS)
            if not _wake.is_set():
                break
        write_all()


def request_export() -> None:
    """Ask for a refresh soon. Returns immediately; never raises."""
    global _worker

    if not _enabled():
        return

    if _worker is None:
        with _worker_lock:
            if _worker is None:
                _worker = threading.Thread(target=_run, name="mirror", daemon=True)
                _worker.start()

    _wake.set()
