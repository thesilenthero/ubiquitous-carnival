#!/usr/bin/env python3
"""
Copy every attached resume and cover letter into the off-machine archive.

The app mirrors each attachment as it is uploaded (server/repo.py,
_archive_attachment), but that is best-effort: an upload succeeds even when the
archive is unreachable, because a degraded export beats a refused upload. This
script is the other half of that bargain — run it to backfill documents attached
before mirroring existed, and to repair anything missed while iCloud was offline.

It reads the documents out of the database, which is where they live; the
archive is an export of that, not a second store.

Idempotent. Files already present with identical bytes are left alone, so it is
safe to re-run as often as you like, including from a scheduled job.

Usage:
  python3 scripts/backup_attachments.py            # archive everything
  python3 scripts/backup_attachments.py --dry-run  # report, change nothing

Honours DB_PATH and ATTACHMENT_BACKUP_DIR. Exits non-zero if anything failed.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import attachment_files as af  # noqa: E402
from server.db import DB_PATH  # noqa: E402


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if af.BACKUP_ROOT is None:
        print("ATTACHMENT_BACKUP_DIR is empty — archiving is turned off.")
        return 0

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    kinds = (af.RESUME, af.COVER_LETTER)
    rows = conn.execute(
        """SELECT id, company, role_title, date_applied, backup_dir
             FROM applications
            ORDER BY date_applied"""
    ).fetchall()

    copied = present = failed = 0
    print(f"Archive: {af.BACKUP_ROOT}")
    print(f"Source:  {DB_PATH}\n")

    for row in rows:
        app = {
            "id": row["id"],
            "company": row["company"],
            "roleTitle": row["role_title"],
            "dateApplied": row["date_applied"],
            "backupDir": row["backup_dir"],
        }
        folder = app["backupDir"] or af.backup_folder_name(app)
        claimed = bool(row["backup_dir"])

        for kind in kinds:
            # One blob at a time, and only for applications that have one. The
            # bytes are read here rather than joined above so a full run holds
            # a single document in memory, not the whole corpus.
            blob = conn.execute(
                "SELECT bytes FROM attachment_blobs WHERE application_id = ? AND kind = ?",
                (row["id"], kind.key),
            ).fetchone()
            if blob is None:
                continue

            # Distinguish "already archived" from "copied" for the summary; the
            # mirror itself treats both as success and skips identical bytes.
            already = af.backup_path(kind, folder).exists()

            if dry_run:
                print(f"  {'ok  ' if already else 'copy'}  {folder}/{kind.default_name}")
                present += 1 if already else 0
                copied += 0 if already else 1
                continue

            if af.mirror(kind, blob["bytes"], folder):
                if already:
                    present += 1
                else:
                    copied += 1
                    print(f"  copied  {folder}/{kind.default_name}")
            else:
                failed += 1
                print(f"  FAILED  {folder}/{kind.default_name}", file=sys.stderr)
                continue

            # Claim the folder for this application so the running app reuses it
            # rather than deriving a fresh name from fields that may have moved.
            if not claimed:
                conn.execute(
                    "UPDATE applications SET backup_dir = ? WHERE id = ?",
                    (folder, row["id"]),
                )
                claimed = True

    if not dry_run:
        conn.commit()
    conn.close()

    verb = "would copy" if dry_run else "copied"
    print(f"\n{verb} {copied}, already present {present}, failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
