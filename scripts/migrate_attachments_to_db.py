#!/usr/bin/env python3
"""
Move the attached PDFs off the filesystem and into the database.

Attachments used to live under data/resumes/ and data/cover_letters/, with only
a filename recorded on the application row. They now live in `attachment_blobs`
(see server/db.py) so the app can be deployed against a hosted database with no
filesystem of its own. This script carries the existing documents across.

It runs in two phases, on purpose, so a bad migration is survivable:

  1. migrate — read each file, write it into the database, and verify the blob
     that came back matches the file byte for byte. The files on disk are NOT
     touched. Re-running is safe: a document already stored with a matching
     hash is left alone.

  2. --prune — only after you have used the app and are satisfied. Deletes the
     disk copies whose blobs verify, nulls the now-meaningless *_path columns,
     and removes the empty directories.

Usage:
  python3 scripts/migrate_attachments_to_db.py --dry-run   # report, change nothing
  python3 scripts/migrate_attachments_to_db.py             # phase 1
  python3 scripts/migrate_attachments_to_db.py --prune     # phase 2, later

Honours DB_PATH. Exits non-zero if anything failed to migrate or verify.
"""
import datetime as dt
import hashlib
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import attachment_files as af  # noqa: E402
from server.db import DB_PATH  # noqa: E402

KINDS = (af.RESUME, af.COVER_LETTER)


def _dir_for(kind: af.Kind) -> str:
    """The retired store's directory for a kind.

    Rebuilt here rather than imported: attachment_files no longer knows about
    directories, and this script is the last thing that needs to.
    """
    return os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), kind.dir_name)


def _source_path(kind: af.Kind, stored_name: str) -> str:
    """Resolve a stored filename, refusing anything that escapes the directory.

    The same containment rule the old attachment_files.path_for enforced. A
    tampered database value must not be able to read an arbitrary file into a
    blob.
    """
    base = _dir_for(kind)
    candidate = os.path.realpath(os.path.join(base, stored_name))
    if os.path.dirname(candidate) != os.path.realpath(base):
        raise ValueError(f"{stored_name!r} escapes {kind.dir_name}/")
    return candidate


def migrate(conn: sqlite3.Connection, dry_run: bool) -> tuple[int, int, int, int]:
    cols = ", ".join(k.path_col for k in KINDS)
    rows = conn.execute(
        f"SELECT id, company, role_title, {cols} FROM applications ORDER BY date_applied"
    ).fetchall()

    migrated = present = missing = failed = 0

    for row in rows:
        for kind in KINDS:
            stored = row[kind.path_col]
            if not stored:
                continue
            label = f"{row['company']} | {row['role_title']} {kind.key}"

            try:
                source = _source_path(kind, stored)
                with open(source, "rb") as fh:
                    data = fh.read()
            except (ValueError, OSError) as err:
                # Recorded in the row but not readable on disk. Report it and
                # keep going — one lost file must not stop the other 191.
                print(f"  MISSING  {label}: {err}", file=sys.stderr)
                missing += 1
                continue

            digest = hashlib.sha256(data).hexdigest()
            existing = conn.execute(
                "SELECT sha256 FROM attachment_blobs WHERE application_id = ? AND kind = ?",
                (row["id"], kind.key),
            ).fetchone()
            if existing and existing["sha256"] == digest:
                present += 1
                continue

            if dry_run:
                print(f"  would migrate {label}  ({len(data):,} bytes)")
                migrated += 1
                continue

            conn.execute(
                """INSERT INTO attachment_blobs
                     (application_id, kind, bytes, byte_size, sha256, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(application_id, kind) DO UPDATE SET
                     bytes = excluded.bytes, byte_size = excluded.byte_size,
                     sha256 = excluded.sha256, created_at = excluded.created_at""",
                (row["id"], kind.key, data, len(data),
                 digest, dt.datetime.now(dt.timezone.utc).isoformat()),
            )

            # Read it straight back. A migration that reports success without
            # checking is worth very little — this is the whole reason the disk
            # copies survive phase 1.
            check = conn.execute(
                "SELECT bytes, byte_size, sha256 FROM attachment_blobs"
                " WHERE application_id = ? AND kind = ?",
                (row["id"], kind.key),
            ).fetchone()
            if (
                check is None
                or check["byte_size"] != len(data)
                or check["sha256"] != digest
                or hashlib.sha256(check["bytes"]).hexdigest() != digest
            ):
                print(f"  FAILED   {label}: blob did not verify", file=sys.stderr)
                failed += 1
                continue

            migrated += 1

    return migrated, present, missing, failed


def prune(conn: sqlite3.Connection, dry_run: bool) -> int:
    """Delete disk copies whose blobs verify, then null the *_path columns."""
    cols = ", ".join(k.path_col for k in KINDS)
    rows = conn.execute(f"SELECT id, {cols} FROM applications").fetchall()

    removed = kept = 0
    for row in rows:
        for kind in KINDS:
            stored = row[kind.path_col]
            if not stored:
                continue
            blob = conn.execute(
                "SELECT sha256 FROM attachment_blobs WHERE application_id = ? AND kind = ?",
                (row["id"], kind.key),
            ).fetchone()
            try:
                source = _source_path(kind, stored)
                on_disk = hashlib.sha256(open(source, "rb").read()).hexdigest()
            except (ValueError, OSError):
                # Already gone, or unreadable. Nothing to delete; the column is
                # cleared below either way.
                continue
            if blob is None or blob["sha256"] != on_disk:
                # Never delete a file the database cannot reproduce.
                print(f"  KEPT     {stored}: no verified blob", file=sys.stderr)
                kept += 1
                continue
            if dry_run:
                print(f"  would remove {stored}")
            else:
                os.remove(source)
            removed += 1

    # Whatever is left in the directories is referenced by no application row —
    # a document from a row that was deleted or recreated. Never deleted here:
    # this script's job is to move the app's attachments, not to garbage-collect
    # files it does not understand. They are reported so the empty directory is
    # not a mystery.
    orphans = []
    for kind in KINDS:
        directory = _dir_for(kind)
        if os.path.isdir(directory):
            orphans += [os.path.join(directory, f) for f in sorted(os.listdir(directory))
                        if f.endswith(".pdf")]

    if not dry_run and not kept:
        conn.execute(
            f"UPDATE applications SET {', '.join(f'{k.path_col} = NULL' for k in KINDS)}"
        )
        for kind in KINDS:
            directory = _dir_for(kind)
            try:
                os.rmdir(directory)
                print(f"  removed  {directory}/")
            except OSError:
                # Not empty (orphans, reported below) or already gone.
                pass

    verb = "would remove" if dry_run else "removed"
    print(f"\n{verb} {removed}, kept {kept}")
    if kept:
        print("Nothing was cleared: resolve the kept files first, then re-run.",
              file=sys.stderr)
    if orphans:
        print(f"\n{len(orphans)} file(s) belong to no application and were left alone:")
        for o in orphans:
            print(f"  {o}")
        print("Delete them by hand if you do not want them.")
    return 1 if kept else 0


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    pruning = "--prune" in sys.argv

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    print(f"Database: {DB_PATH}")
    print(f"Phase:    {'prune' if pruning else 'migrate'}"
          f"{' (dry run)' if dry_run else ''}\n")

    if pruning:
        code = prune(conn, dry_run)
    else:
        migrated, present, missing, failed = migrate(conn, dry_run)
        verb = "would migrate" if dry_run else "migrated"
        print(f"\n{verb} {migrated}, already stored {present}, "
              f"missing {missing}, failed {failed}")
        if not dry_run and not (missing or failed):
            print("\nThe files on disk are untouched. Use the app, and once you are\n"
                  "satisfied, run again with --prune to remove them.")
        code = 1 if (missing or failed) else 0

    if not dry_run:
        conn.commit()
    conn.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
