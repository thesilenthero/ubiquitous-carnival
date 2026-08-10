"""On-disk storage for attached resume PDFs.

The bytes live beside the database in `data/resumes/` rather than in a BLOB
column: every resume here is a unique tweak of a previous one, so at ~440
uploads a month a BLOB would push app.db past a gigabyte within a year and every
manual `cp` backup would copy all of it again. On disk the database stays small
and the files are browsable — which matters, because the way a new resume gets
made is by opening an old one and editing it.

This module owns the directory and **every path decision**. No route joins paths
itself; a filename that came from a client must never reach the filesystem.
"""
import datetime as dt
import re
from pathlib import Path
from typing import Optional

from .db import DB_PATH

MAX_BYTES = 10 * 1024 * 1024  # a resume is a few hundred KB; 10MB is generous
PDF_MAGIC = b"%PDF-"


def resume_dir() -> Path:
    """Resolved once per call so an overridden DB_PATH still works (the README
    documents DB_PATH, and the test suite relies on it)."""
    d = Path(DB_PATH).resolve().parent / "resumes"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slug(value: str, limit: int = 28) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return s[:limit].strip("-")


def stored_name_for(app: dict) -> str:
    """Build the on-disk filename. Generated, never derived from the upload.

    Shaped so the folder is readable at a glance and a file can be traced back
    to its row: 2026-08-10-cibc-senior-analyst-a1b2c3d4.pdf
    """
    parts = [
        dt.datetime.now(dt.timezone.utc).date().isoformat(),
        _slug(app.get("company") or ""),
        _slug(app.get("roleTitle") or ""),
        (app.get("id") or "")[:8],
    ]
    return "-".join(p for p in parts if p) + ".pdf"


def path_for(stored_name: str) -> Path:
    """Resolve a stored filename to an absolute path inside the resume folder.

    Every read and delete goes through here. The containment check is the whole
    point: even a tampered database value cannot reach outside the directory.
    """
    if not stored_name:
        raise ValueError("no resume file recorded")
    base = resume_dir()
    candidate = (base / stored_name).resolve()
    if candidate.parent != base:
        raise ValueError("resume path escapes the resume directory")
    return candidate


def save(app: dict, data: bytes) -> tuple[str, int]:
    """Write the PDF and return (stored_name, size). Overwrites in place."""
    name = stored_name_for(app)
    path_for(name).write_bytes(data)
    return name, len(data)


def delete(stored_name: Optional[str]) -> None:
    """Remove a stored file. Tolerant of one that is already gone."""
    if not stored_name:
        return
    try:
        path_for(stored_name).unlink(missing_ok=True)
    except ValueError:
        # A bad stored value can't be turned into a path; there is nothing to
        # unlink, and refusing to delete the row over it would be worse.
        pass


def read(stored_name: str) -> bytes:
    return path_for(stored_name).read_bytes()


def looks_like_pdf(data: bytes, filename: str) -> bool:
    return data[:5] == PDF_MAGIC or filename.lower().endswith(".pdf")


def extract_text(data: bytes) -> Optional[str]:
    """Pull the text layer out of a PDF, or None.

    Returning None is a normal outcome, not an error: a resume exported as
    images has no text layer. The upload still succeeds — the point is to keep
    `resume_text` (and therefore the CSV export) populated when we can.
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
