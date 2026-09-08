"""On-disk storage for the PDFs attached to an application.

Two kinds are attachable — the resume and the cover letter — and they behave
identically, so everything here is parameterized by `Kind` rather than written
twice. Adding a third kind is one entry in `KINDS` plus five columns.

The bytes live beside the database in `data/resumes/` and `data/cover_letters/`
rather than in BLOB columns: every document here is a unique tweak of a previous
one, so at ~440 uploads a month BLOBs would push app.db past a gigabyte within a
year and every manual `cp` backup would copy all of it again. On disk the
database stays small and the files are browsable — which matters, because the way
a new resume gets made is by opening an old one and editing it.

This module owns the directories and **every path decision**. No route joins
paths itself; a filename that came from a client must never reach the filesystem.
"""
import datetime as dt
import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .db import DB_PATH

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024  # a resume is a few hundred KB; 10MB is generous
PDF_MAGIC = b"%PDF-"

# A second home for every attachment, on top of data/{resumes,cover_letters}/.
# These documents are the hardest thing here to reproduce — each new resume is
# made by editing the last one — so they get a copy somewhere that syncs off the
# machine. Set ATTACHMENT_BACKUP_DIR="" to turn mirroring off entirely.
_BACKUP_DEFAULT = "~/Documents/Career/Applications"
_backup_env = os.environ.get("ATTACHMENT_BACKUP_DIR", _BACKUP_DEFAULT)
BACKUP_ROOT: Optional[Path] = Path(_backup_env).expanduser() if _backup_env else None


@dataclass(frozen=True)
class Kind:
    """One attachable document type, and the five columns that record it.

    The column names live here and nowhere else. They are interpolated into SQL
    in repo.py, which is safe precisely because they are constants from this
    table — a `kind` from a request is resolved through `KINDS` first (see
    `by_key`), so a request string never reaches an f-string.
    """

    key: str  # the URL segment
    label: str  # how it reads in an error message
    dir_name: str
    default_name: str  # Content-Disposition fallback
    path_col: str
    filename_col: str
    size_col: str
    uploaded_col: str
    text_col: str


RESUME = Kind(
    key="resume",
    label="resume",
    dir_name="resumes",
    default_name="resume.pdf",
    path_col="resume_path",
    filename_col="resume_filename",
    size_col="resume_size",
    uploaded_col="resume_uploaded_at",
    text_col="resume_text",
)

COVER_LETTER = Kind(
    key="cover-letter",
    label="cover letter",
    dir_name="cover_letters",
    default_name="cover-letter.pdf",
    path_col="cover_letter_path",
    filename_col="cover_letter_filename",
    size_col="cover_letter_size",
    uploaded_col="cover_letter_uploaded_at",
    text_col="cover_letter_text",
)

KINDS: dict[str, Kind] = {RESUME.key: RESUME, COVER_LETTER.key: COVER_LETTER}


def by_key(key: str) -> Optional[Kind]:
    """Resolve a URL segment to a Kind, or None. The only way a request-supplied
    string is allowed to become a Kind."""
    return KINDS.get(key)


def dir_for(kind: Kind) -> Path:
    """Resolved once per call so an overridden DB_PATH still works (the README
    documents DB_PATH, and the test suite relies on it)."""
    d = Path(DB_PATH).resolve().parent / kind.dir_name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slug(value: str, limit: int = 28) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return s[:limit].strip("-")


# --- The iCloud archive ---------------------------------------------------
#
# Same module, because the rule at the top of this file still holds: no caller
# joins its own paths. The archive differs from the primary store in two ways
# that matter, both deliberate:
#
#   * It is organized per application, not per kind. The primary store gets away
#     with one directory per kind because a resume and its cover letter generate
#     the SAME filename (see stored_name_for) and only avoid collision by living
#     in different folders — flattening them into one archive directory would
#     silently overwrite half of it.
#   * It is append-only. Nothing here deletes; `delete()` below touches only the
#     primary copy. A backup that disappears when you detach a file in the app
#     does not protect you from the mistake a backup is for.


def _safe(value: str, limit: int = 80) -> str:
    """A human-readable path component. Unlike `_slug`, keeps case and spaces.

    `/` is a path separator and `:` is still shown as one by Finder, so both are
    replaced rather than stripped — dropping them would run words together.
    """
    s = re.sub(r"[/:\\]+", "-", value or "")
    s = "".join(ch for ch in s if ch.isprintable())
    s = re.sub(r"\s+", " ", s).strip(" .-")
    return s[:limit].strip(" .-")


def backup_folder_name(app: dict) -> str:
    """The archive folder for one application: "2026-08-15 Scotiabank — Manager".

    Computed once and then stored on the row (`backup_dir`), because the inputs
    move: `date_applied` is rewritten when a docketed role reaches `applied`,
    and company and role are both editable. Recomputing on every upload would
    scatter one application's documents across several folders.
    """
    date = (app.get("dateApplied") or "")[:10]
    who = " — ".join(
        p for p in (_safe(app.get("company") or ""), _safe(app.get("roleTitle") or "")) if p
    )
    name = _safe(" ".join(p for p in (date, who) if p))
    # An application with no usable company or role still needs somewhere to go.
    return name or f"application-{(app.get('id') or 'unknown')[:8]}"


def backup_path(kind: Kind, folder: str) -> Optional[Path]:
    """Where a kind's document lives in the archive, or None if archiving is off.

    The kind is the *filename* here rather than the directory, which is what
    lets one folder hold an application's whole set.
    """
    if BACKUP_ROOT is None:
        return None
    return BACKUP_ROOT / _safe(folder) / kind.default_name


def _versioned_sibling(dest: Path) -> Path:
    """A free name to move `dest` aside to, dated by when it was written."""
    stamp = dt.date.fromtimestamp(dest.stat().st_mtime).isoformat()
    candidate = dest.with_name(f"{dest.stem} ({stamp}){dest.suffix}")
    n = 2
    while candidate.exists():
        candidate = dest.with_name(f"{dest.stem} ({stamp}) ({n}){dest.suffix}")
        n += 1
    return candidate


def mirror(kind: Kind, stored_name: str, folder: str) -> bool:
    """Copy an attachment into the archive. True if the archive now holds it.

    Copies the file that was actually persisted rather than the uploaded bytes,
    so the archive is a copy of the real record, not a second interpretation of
    the request.

    Never raises: an unreachable or unwritable archive is a degraded backup, not
    a failed upload, and the primary copy is already safe by the time this runs.
    """
    dest = backup_path(kind, folder)
    if dest is None:
        return False
    try:
        source = path_for(kind, stored_name)
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists():
            # Re-uploading the same document is common (a stray double-click, a
            # re-run of the backfill). Identical bytes means there is nothing to
            # archive and no reason to churn a synced folder.
            if dest.stat().st_size == source.stat().st_size and dest.read_bytes() == source.read_bytes():
                return True
            dest.rename(_versioned_sibling(dest))

        shutil.copy2(source, dest)
        return True
    except Exception as e:  # noqa: BLE001 — see the docstring
        log.warning(
            "Could not archive the %s to %s: %s. The primary copy under %s is "
            "unaffected; run scripts/backup_attachments.py to retry.",
            kind.label,
            BACKUP_ROOT,
            e,
            kind.dir_name,
        )
        return False


def stored_name_for(kind: Kind, app: dict) -> str:
    """Build the on-disk filename. Generated, never derived from the upload.

    Shaped so the folder is readable at a glance and a file can be traced back
    to its row: 2026-08-10-cibc-senior-analyst-a1b2c3d4.pdf

    The two kinds can produce the same name; they never collide because each
    kind has its own directory.
    """
    parts = [
        dt.datetime.now(dt.timezone.utc).date().isoformat(),
        _slug(app.get("company") or ""),
        _slug(app.get("roleTitle") or ""),
        (app.get("id") or "")[:8],
    ]
    return "-".join(p for p in parts if p) + ".pdf"


def path_for(kind: Kind, stored_name: str) -> Path:
    """Resolve a stored filename to an absolute path inside the kind's folder.

    Every read and delete goes through here. The containment check is the whole
    point: even a tampered database value cannot reach outside the directory.
    """
    if not stored_name:
        raise ValueError(f"no {kind.label} file recorded")
    base = dir_for(kind)
    candidate = (base / stored_name).resolve()
    if candidate.parent != base:
        raise ValueError(f"{kind.label} path escapes the {kind.dir_name} directory")
    return candidate


def save(kind: Kind, app: dict, data: bytes) -> tuple[str, int]:
    """Write the PDF and return (stored_name, size). Overwrites in place."""
    name = stored_name_for(kind, app)
    path_for(kind, name).write_bytes(data)
    return name, len(data)


def delete(kind: Kind, stored_name: Optional[str]) -> None:
    """Remove a stored file. Tolerant of one that is already gone.

    Deletes the primary copy only — the archive under BACKUP_ROOT is append-only
    and is deliberately left alone. See the archive section above.
    """
    if not stored_name:
        return
    try:
        path_for(kind, stored_name).unlink(missing_ok=True)
    except ValueError:
        # A bad stored value can't be turned into a path; there is nothing to
        # unlink, and refusing to delete the row over it would be worse.
        pass


def read(kind: Kind, stored_name: str) -> bytes:
    return path_for(kind, stored_name).read_bytes()


def looks_like_pdf(data: bytes, filename: str) -> bool:
    return data[:5] == PDF_MAGIC or filename.lower().endswith(".pdf")


def extract_text(data: bytes) -> Optional[str]:
    """Pull the text layer out of a PDF, or None.

    Returning None is a normal outcome, not an error: a document exported as
    images has no text layer. The upload still succeeds — the point is to keep
    the archived text populated when we can.
    """
    import io

    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return None
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None
