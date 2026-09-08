"""Keeps an always-current set of CSVs of the tracker in a synced folder.

This app replaced a Google Sheet, but the Sheet was also the copy of the data you
could read with nothing running. The export endpoint alone doesn't restore that:
it drops a date-stamped file in ~/Downloads only when someone remembers to click
it, so the synced copy is always stale. Here the server keeps them current
itself, writing after every change to **fixed** filenames. Overwriting in place
rather than adding a timestamp is deliberate — a stable name means a stable
link, and whatever syncs the folder keeps its own version history.

The bytes are exactly what `GET /api/export.zip` holds — but written as loose
CSVs, not an archive: a zip is not something you can open on a phone.
`csv_io.EXPORT_FILES` is the single source of truth for what the export contains
and nothing here reshapes it; this module only decides the filenames.

This module only writes; server/mirror.py decides when, and drives the Google
Sheet mirror (server/sheets_sync.py) off the same trigger.

Set CSV_EXPORT_DIR="" to turn mirroring off, or point it elsewhere.
"""
import logging
import os
import sqlite3
from pathlib import Path
from typing import Optional

from .csv_io import EXPORT_FILES
from .db import connect

log = logging.getLogger(__name__)

# A folder of our own under the same Career tree the attachment archive uses.
_EXPORT_DEFAULT = "~/Documents/Career/Job Tracker Data"
_export_env = os.environ.get("CSV_EXPORT_DIR", _EXPORT_DEFAULT)
EXPORT_DIR: Optional[Path] = Path(_export_env).expanduser() if _export_env else None

# Mirror filenames, one per entry in EXPORT_FILES. Kept prefixed now that the
# mirror has a folder to itself: the names are what any existing link points at.
EXPORT_NAMES = {
    "applications.csv": "job-applications.csv",
    "stage-events.csv": "job-stage-events.csv",
    "interviews.csv": "job-interviews.csv",
    "interactions.csv": "job-interactions.csv",
    "activity.csv": "job-activity.csv",
}

_warned_unreachable = False


def export_paths() -> list[Path]:
    """Every file the mirror writes, in order. Empty when mirroring is off."""
    if EXPORT_DIR is None:
        return []
    return [EXPORT_DIR / name for name in EXPORT_NAMES.values()]


def _write_one(path: Path, text: str) -> bool:
    """Write one mirrored file. Returns True only if bytes actually changed."""
    # A write means a Drive upload, so don't spend one on identical bytes. This
    # is what makes the read-only POSTs (the AI endpoints) free, and what makes
    # scripts/export_csv.py safe to run on a schedule.
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False

    # Write aside and rename, so a reader — or the sync client — never sees a
    # half-written file under the real name.
    tmp = path.with_name("." + path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return True


def write_export(conn: Optional[sqlite3.Connection] = None) -> bool:
    """Refresh the mirrored CSVs. Returns True if any file's bytes changed.

    Never raises. This runs off the back of a request that has already
    succeeded, and a backup that can't be written is not a reason to tell the
    user their edit failed. One unreachable folder is one warning, not four.
    """
    global _warned_unreachable

    if EXPORT_DIR is None:
        return False

    try:
        # Deliberately no mkdir: if the Drive volume isn't mounted, creating the
        # folder locally would make Drive sync a stray directory on reconnect.
        if not EXPORT_DIR.is_dir():
            if not _warned_unreachable:
                log.warning("CSV mirror skipped — %s is not reachable", EXPORT_DIR)
                _warned_unreachable = True
            return False

        own_conn = conn is None
        conn = conn or connect()
        try:
            texts = {name: build(conn) for name, build in EXPORT_FILES.items()}
        finally:
            if own_conn:
                conn.close()

        # Every file is attempted even if one fails: a wedged interviews.csv is
        # no reason to leave the applications sheet stale.
        changed = False
        for name, text in texts.items():
            path = EXPORT_DIR / EXPORT_NAMES[name]
            try:
                changed |= _write_one(path, text)
            except Exception:
                log.warning("CSV mirror to %s failed", path, exc_info=True)

        _warned_unreachable = False
        return changed
    except Exception:
        log.warning("CSV mirror to %s failed", EXPORT_DIR, exc_info=True)
        return False
