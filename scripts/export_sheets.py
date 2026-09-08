#!/usr/bin/env python3
"""
Refresh the Google Sheet mirror of the tracker.

The app pushes to the Sheet after every change it serves (server/sheets_sync.py
via server/mirror.py), so normally this never needs running. It exists for the
changes the server doesn't see: a direct `sqlite3` edit, an import script, or
the first push before the server has been restarted with the Sheet configured.

Idempotent — a push only happens when the data actually differs from the last
one, so this is safe to re-run or schedule. Note that "last one" is per-process:
run standalone, the first invocation always pushes.

Usage:
  python3 scripts/export_sheets.py            # push if anything changed
  python3 scripts/export_sheets.py --dry-run  # report, change nothing

Honours DB_PATH, GOOGLE_SHEET_ID and GOOGLE_SHEETS_CREDENTIALS. Exits non-zero
if the push failed.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import sheets_sync as ss  # noqa: E402
from server.db import DB_PATH, connect  # noqa: E402


def main() -> int:
    # write_export only logs its failures; surface them on the console.
    logging.basicConfig(format="%(levelname)s %(message)s")

    dry_run = "--dry-run" in sys.argv

    if not ss.is_configured():
        print(ss.status()["lastError"])
        return 0

    print(f"Source: {DB_PATH}")
    print(f"Sheet:  {ss.sheet_url()}\n")

    if dry_run:
        conn = connect()
        try:
            payload = ss.build_payload(conn)
        finally:
            conn.close()
        for tab, rows in payload.items():
            # Header row doesn't count as a record.
            print(f"  would write {len(rows) - 1:>4} rows  {tab}")
        return 0

    if ss.write_export(throttle=False):
        print("  pushed")
        return 0

    if ss.status()["lastError"] is None:
        print("  unchanged")
        return 0

    print("  FAILED  see the log above", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
