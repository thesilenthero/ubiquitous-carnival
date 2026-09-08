"""The PDFs attached to an application: validation, naming, and the archive.

Two kinds are attachable — the resume and the cover letter — and they behave
identically, so everything here is parameterized by `Kind` rather than written
twice. Adding a third kind is one entry in `KINDS` plus five columns.

The bytes live in the database, in the `attachment_blobs` table (see db.py), not
on disk. An earlier version of this module stored them under data/resumes/ and
data/cover_letters/ and argued that BLOBs would push app.db past a gigabyte
within a year. Measured against the real corpus once it existed, that was wrong
by roughly 3x: 192 attachments came to 11.8MB, averaging 63KB with the largest
at 141KB. Even at 440 uploads a month that is ~28MB a month, and app.db holding
all of it is ~14MB.

What the on-disk store cost instead was portability, and that is the reason for
the move: the app is meant to be deployable to a cloud database, and a host with
an ephemeral filesystem cannot keep the documents. In the database they travel
with everything else, and BLOB ports directly to Postgres BYTEA.

What remains here is everything that is *not* storage: the Kind table, the
upload validation, text extraction, and the off-machine archive below — which is
now a best-effort export rather than a copy of a primary file.
"""
import datetime as dt
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024  # a resume is a few hundred KB; 10MB is generous
PDF_MAGIC = b"%PDF-"

# A second home for every attachment, on top of data/{resumes,cover_letters}/.
# These documents are the hardest thing here to reproduce — each new resume is
# made by editing the last one — so they get a copy somewhere that syncs off the
# machine. Set ATTACHMENT_BACKUP_DIR="" to turn mirroring off entirely.
_BACKUP_DEFAULT = "~/Documents/Career/Applications"
_backup_env = os.environ.get("ATTACHMENT_BACKUP_DIR", _BACKUP_DEFAULT)


def _resolve_backup_root(value: str) -> Optional[Path]:
    """The archive directory, or None when there should not be one.

    Empty turns archiving off explicitly. A *parent* that does not exist turns
    it off implicitly, which is what happens on a cloud host: there is no
    ~/Documents/Career there, and creating a stray tree under a container's
    home directory would archive documents into something that vanishes on the
    next deploy. Missing only the leaf is normal — a first run makes it.
    """
    if not value:
        return None
    root = Path(value).expanduser()
    return root if root.parent.exists() else None


BACKUP_ROOT: Optional[Path] = _resolve_backup_root(_backup_env)


@dataclass(frozen=True)
class Kind:
    """One attachable document type, and the columns that record it.

    The column names live here and nowhere else. They are interpolated into SQL
    in repo.py, which is safe precisely because they are constants from this
    table — a `kind` from a request is resolved through `KINDS` first (see
    `by_key`), so a request string never reaches an f-string. `key` is also the
    `kind` value stored in `attachment_blobs`, for the same reason.
    """

    key: str  # the URL segment, and the `kind` column in attachment_blobs
    label: str  # how it reads in an error message
    dir_name: str  # the retired data/ subdirectory; read by the migration only
    default_name: str  # Content-Disposition fallback, and the archive filename
    path_col: str  # likewise retired: the migration reads it, then it is dropped
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


# --- The iCloud archive ---------------------------------------------------
#
# The one place attachments still touch a filesystem, and the reason this module
# still owns **every path decision**: no caller joins its own paths, and no name
# that came from a client is ever used as one.
#
# Now that the database holds the documents, this is an export rather than a
# backup of a primary file — but it is not decoration. The way a new resume gets
# made is by opening an old one and editing it, and that wants a folder you can
# browse in Finder, not a BLOB you have to query for. Two properties matter:
#
#   * It is organized per application, not per kind, so an application's resume
#     and cover letter sit together in one folder named for the role.
#   * It is append-only. Nothing here deletes: detaching a document in the app
#     leaves the archived copy alone, and re-attaching moves the old one aside
#     with a dated name (see `_versioned_sibling`). A backup that disappears
#     when you delete something does not protect you from the mistake a backup
#     is for.
#
# It is also entirely optional. `ATTACHMENT_BACKUP_DIR=""`, or a host with no
# ~/Documents/Career, turns it off and nothing is written outside the database.


def _safe(value: str, limit: int = 80) -> str:
    """A human-readable path component: keeps case and spaces.

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


def mirror(kind: Kind, data: bytes, folder: str) -> bool:
    """Copy an attachment into the archive. True if the archive now holds it.

    Writes the same bytes that were committed to `attachment_blobs`, so the
    archive is a copy of the real record rather than a second interpretation of
    the request.

    Never raises: an unreachable or unwritable archive is a degraded backup, not
    a failed upload, and the database already holds the document by the time
    this runs.
    """
    dest = backup_path(kind, folder)
    if dest is None:
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)

        if dest.exists():
            # Re-uploading the same document is common (a stray double-click, a
            # re-run of the backfill). Identical bytes means there is nothing to
            # archive and no reason to churn a synced folder.
            if dest.stat().st_size == len(data) and dest.read_bytes() == data:
                return True
            dest.rename(_versioned_sibling(dest))

        dest.write_bytes(data)
        return True
    except Exception as e:  # noqa: BLE001 — see the docstring
        log.warning(
            "Could not archive the %s to %s: %s. The copy in the database is "
            "unaffected; run scripts/backup_attachments.py to retry.",
            kind.label,
            BACKUP_ROOT,
            e,
        )
        return False


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
