#!/usr/bin/env python3
"""
Refresh the synced CSV copies of the tracker.

The app mirrors the CSVs after every change it serves (server/csv_backup.py), so
normally this never needs running. It exists for the changes the server doesn't
see: a direct `sqlite3` edit, an import script, or the first run before the
server has been restarted with mirroring in it.

Idempotent — identical bytes are left alone, so a file's timestamp only moves
when its data actually did. Safe to re-run or schedule.

Usage:
  python3 scripts/export_csv.py            # refresh the mirror
  python3 scripts/export_csv.py --dry-run  # report, change nothing

Honours DB_PATH and CSV_EXPORT_DIR. Exits non-zero if the write failed.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import csv_backup as cb  # noqa: E402
from server.csv_io import EXPORT_FILES, parse_csv  # noqa: E402
from server.db import DB_PATH, connect  # noqa: E402


def main() -> int:
    # write_export only logs its failures; surface them on the console.
    logging.basicConfig(format="%(levelname)s %(message)s")

    dry_run = "--dry-run" in sys.argv

    paths = cb.export_paths()
    if not paths:
        print('CSV_EXPORT_DIR is empty — mirroring is turned off.')
        return 0

    print(f"Source: {DB_PATH}")
    print(f"Mirror: {cb.EXPORT_DIR}\n")

    if dry_run:
        if not cb.EXPORT_DIR.is_dir():
            print(f"  FAILED  {cb.EXPORT_DIR} is not reachable", file=sys.stderr)
            return 1
        conn = connect()
        try:
            texts = {name: build(conn) for name, build in EXPORT_FILES.items()}
        finally:
            conn.close()
        for name, text in texts.items():
            path = cb.EXPORT_DIR / cb.EXPORT_NAMES[name]
            current = path.read_text(encoding="utf-8") if path.exists() else None
            # Not a newline count: job_description, resume_text and interview
            # notes hold plenty of their own. Parse it back to count records.
            rows = len(parse_csv(text)) - 1
            verb = "ok        unchanged," if current == text else "would write "
            print(f"  {verb} {rows:>4} rows  {path.name}")
        return 0

    if cb.write_export():
        print("  written")
        return 0

    # write_export logs the reason; distinguish "nothing to do" from a failure
    # by whether every mirrored file is there and already current.
    if all(p.exists() for p in paths):
        print("  unchanged")
        return 0

    print("  FAILED  see the log above", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
