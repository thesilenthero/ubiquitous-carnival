#!/usr/bin/env python3
"""
Backfill attachments from the hand-filed "Archived Applications/" folders.

Before this tracker existed, every application was filed by hand into a folder
holding a resume, the job posting, and sometimes a cover letter. This walks that
archive and attaches each document to its application, so the historical rows
look like ones created in the app.

Three steps, run in order:

  map      match folders to applications, write scripts/archive_map.json
  convert  render the .docx-only resumes to PDF into a staging directory
  apply    attach the files and fill in job_description

Matching is a separate step on purpose: it writes its decisions to a JSON file
you can read and correct, and `apply` is then a dumb executor over that file.

Attachments go through attachment_files.save + repo.set_attachment — the same
path an upload takes — so text extraction, the activity log, and the off-machine
archive mirror all happen exactly as they would for a real upload. Job
descriptions have no attachment kind (there are only two, resume and cover
letter), so their PDF text lands in applications.job_description and the PDF
stays where it is.

Never overwrites: an application that already has a resume, cover letter, or job
description keeps what it has. That also makes the whole thing re-runnable.

Usage:
  python3 scripts/backfill_archive.py map [--dry-run]
  python3 scripts/backfill_archive.py convert [--dry-run]
  python3 scripts/backfill_archive.py apply [--dry-run]

Honours DB_PATH and ATTACHMENT_BACKUP_DIR. Exits non-zero if anything failed.
"""
import difflib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import attachment_files as af  # noqa: E402
from server import repo  # noqa: E402
from server.db import DB_PATH  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE_DIR = os.path.join(REPO_ROOT, "Archived Applications")
MAP_PATH = os.path.join(REPO_ROOT, "scripts", "archive_map.json")
STAGE_DIR = os.path.join(tempfile.gettempdir(), "job-tracker-backfill-pdfs")

# Folders whose name the scorer cannot resolve on its own: acronyms it cannot
# expand, and two pairs where the nearest row is not the right one. Matched
# against (company, role_title) exactly.
OVERRIDES = {
    "MCCS - Senior Research Analyst": (
        "Ministry of Children, Community and Social Services",
        "Senior Research Analyst",
    ),
    "OPS - Snr Business Solutions Consultant": (
        "Ministry of Municipal Affairs and Housing",
        "Senior Business Solutions Consultant",
    ),
    "Rogers - Manager Forecasts Analytics": ("Rogers", "Forecast Analytics Manager"),
    "Insights Global - Campaign Measurement Manager": (
        "BMO (Insights Global)",
        "Campaign Manager",
    ),
    "Ministry of Finance - Data & Quaity Analyst": (
        "Ontario Ministry of Finance",
        "Data & Quality Analyst",
    ),
}

# City of Toronto applied twice to the same title; the folder names differ only
# by a date suffix, so pin each to its application's month.
DATE_HINTS = {
    "City of Toronto - Business Intelligence Consultant": "2026-02",
    "City of Toronto - Business Intelligence Consultant Apr2026": "2026-04",
}

# No application exists for these three. Each was settled with the user rather
# than guessed at. A value creates an archived application from the folder (the
# date is the earliest file in it); None leaves the folder alone.
ORPHANS = {
    "Altis Recruitment - Digital Marketing Analytics Lead": {
        "company": "Altis Recruitment",
        "roleTitle": "Digital Marketing Analytics Lead",
        "dateApplied": "2026-02-18",
        "source": "Recruiter",
    },
    "University of Toronto - Data & Reporting Analyst": {
        "company": "University of Toronto",
        "roleTitle": "Data & Reporting Analyst",
        "dateApplied": "2026-05-20",
        "source": "Other",
    },
    # A re-application to the role the February row already tracks; left out so
    # the tracker keeps one row per posting.
    "Woodbine - Senior Manager (2nd application)": None,
}

# Top-level PDFs that sit alongside the posting but are not the posting: decks,
# prep notes, take-homes, and the landing pages of an application portal.
NOT_A_POSTING = re.compile(
    r"slides|prep|questionnaire|assessment|candidate home|^success\b", re.I
)

MIN_SCORE = 0.55  # below this, call it unmatched rather than guess


# --- matching ---------------------------------------------------------------


def norm(s: str) -> str:
    """Fold the spelling differences between a folder name and a row."""
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"\b(sr|snr)\b", "senior", s)
    s = re.sub(r"\bmgr\b", "manager", s)
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def toks(s: str) -> set:
    return set(norm(s).split())


def score(folder_part: str, row_part: str, floor: float) -> float:
    """Similarity, with shared words counting for more than character overlap.

    difflib alone reads "TTC" and "Toronto Transit Commission" as unrelated and
    "Rogers - Manager Forecasts Analytics" and "Forecast Analytics Manager" as
    barely related. Token overlap fixes the word-order case; the acronyms are
    handled by OVERRIDES.
    """
    ratio = difflib.SequenceMatcher(None, norm(folder_part), norm(row_part)).ratio()
    shared = toks(folder_part) & toks(row_part)
    if shared:
        ratio = max(ratio, floor + (1 - floor) * len(shared) / max(1, len(toks(folder_part))))
    return ratio


def split_folder(name: str) -> tuple:
    parts = name.split(" - ", 1)
    return parts[0].strip(), (parts[1].strip() if len(parts) > 1 else "")


def build_map(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        "SELECT id, company, role_title, date_applied, resume_path,"
        " cover_letter_path, job_description FROM applications"
    ).fetchall()
    folders = sorted(
        d for d in os.listdir(ARCHIVE_DIR) if os.path.isdir(os.path.join(ARCHIVE_DIR, d))
    )

    fixed, candidates = {}, []
    for folder in folders:
        if folder in ORPHANS:
            continue
        if folder in OVERRIDES:
            company, role = OVERRIDES[folder]
            hit = [r for r in rows if r["company"] == company and r["role_title"] == role]
            if hit:
                fixed[folder] = (hit[0]["id"], 1.0, "override")
                continue
            print(f"  ! override for {folder!r} matched nothing — falling back to scoring")

        f_company, f_role = split_folder(folder)
        hint = DATE_HINTS.get(folder)
        for r in rows:
            company = score(f_company, r["company"], 0.6)
            role = score(f_role, r["role_title"], 0.4) if f_role else 0.5
            total = company * 0.6 + role * 0.4
            if hint:
                total += 0.15 if r["date_applied"].startswith(hint) else -0.15
            if not r["resume_path"]:
                # Nudge toward rows still missing a resume: a folder is far more
                # likely to belong to one of those than to one already filled in.
                total += 0.02
            candidates.append((total, folder, r["id"]))

    # Greedy 1:1. Two folders claiming one row is the failure mode that matters
    # here (Woodbine and City of Toronto both have near-duplicate folders), and
    # taking the best pair first and striking out both sides prevents it.
    candidates.sort(key=lambda c: (-c[0], c[1], c[2]))
    used_folders = set(fixed)
    used_rows = {v[0] for v in fixed.values()}
    assigned = dict(fixed)
    for total, folder, app_id in candidates:
        if folder in used_folders or app_id in used_rows or total < MIN_SCORE:
            continue
        used_folders.add(folder)
        used_rows.add(app_id)
        assigned[folder] = (app_id, round(total, 3), "scored")

    by_id = {r["id"]: r for r in rows}
    entries = []
    for folder in folders:
        if folder in ORPHANS:
            spec = ORPHANS[folder]
            entries.append(
                {
                    "folder": folder,
                    "status": "create" if spec else "skip",
                    "create": spec,
                    "files": classify(folder),
                }
            )
            continue
        if folder not in assigned:
            entries.append({"folder": folder, "status": "unmatched", "files": classify(folder)})
            continue
        app_id, total, reason = assigned[folder]
        r = by_id[app_id]
        entries.append(
            {
                "folder": folder,
                "status": "matched",
                "applicationId": app_id,
                "company": r["company"],
                "roleTitle": r["role_title"],
                "dateApplied": r["date_applied"],
                "score": total,
                "reason": reason,
                "hasResume": bool(r["resume_path"]),
                "hasCoverLetter": bool(r["cover_letter_path"]),
                "hasJobDescription": bool((r["job_description"] or "").strip()),
                "files": classify(folder),
            }
        )
    return {"archiveDir": ARCHIVE_DIR, "entries": entries}


# --- file classification ----------------------------------------------------


def classify(folder: str) -> dict:
    """Sort a folder's top-level PDFs into resume / cover letter / posting.

    Top level only. The Interview/ subfolders (Capital One, Jobber, Manulife)
    hold SQL tests, prep guides and briefings, none of which is the posting.
    """
    path = os.path.join(ARCHIVE_DIR, folder)
    names = sorted(f for f in os.listdir(path) if f.lower().endswith(".pdf"))

    # A "Resume + Cover Letter" PDF is both documents in one file and cannot be
    # attached as either without misfiling it. Set aside for a human.
    combined = [f for f in names if re.search(r"resume", f, re.I) and re.search(r"cover", f, re.I)]
    rest = [f for f in names if f not in combined]

    resumes = [f for f in rest if re.search(r"resume", f, re.I)]
    covers = [f for f in rest if re.search(r"cover", f, re.I)]
    postings = [f for f in rest if f not in resumes and f not in covers]
    postings = [f for f in postings if not NOT_A_POSTING.search(f)]

    out = {
        "resume": pick_resume(path, resumes),
        "coverLetter": covers[0] if covers else None,
        "jobDescription": pick_posting(path, folder, postings),
        "combined": combined,
        "docxResume": None,
    }
    if not out["resume"]:
        out["docxResume"] = pick_docx(path)
    return out


def pick_resume(path: str, names: list) -> str:
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    exact = [f for f in names if f == "Resume - Derrick Gooden.pdf"]
    if exact:
        return exact[0]
    return max(names, key=lambda f: os.path.getmtime(os.path.join(path, f)))


def pick_posting(path: str, folder: str, names: list) -> str:
    """The posting is whichever leftover PDF reads most like the role."""
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    _, role = split_folder(folder)
    if role:
        best = max(names, key=lambda f: score(role, os.path.splitext(f)[0], 0.4))
        if score(role, os.path.splitext(best)[0], 0.4) > 0.5:
            return best
    # Nothing looks like the title — take the one with the most text, which is
    # the posting far more often than a portal screenshot is.
    def text_len(f):
        try:
            with open(os.path.join(path, f), "rb") as fh:
                return len(af.extract_text(fh.read()) or "")
        except OSError:
            return 0

    return max(names, key=text_len)


def pick_docx(path: str) -> str:
    names = [
        f
        for f in sorted(os.listdir(path))
        if f.lower().endswith(".docx") and re.search(r"resume", f, re.I)
    ]
    if not names:
        return None
    exact = [f for f in names if f == "Resume - Derrick Gooden.docx"]
    return exact[0] if exact else names[0]


# --- .docx -> PDF -----------------------------------------------------------


def convert_docx(src: str, dest: str) -> bool:
    """Render a .docx resume to PDF.

    Pages is asked first because it reproduces the layout the document was
    written in. Chrome is the fallback: it always works but reflows the page, so
    a converted resume is a faithful record of the words, not of the formatting.
    """
    if _convert_with_pages(src, dest) or _convert_with_chrome(src, dest):
        return os.path.exists(dest) and os.path.getsize(dest) > 0
    return False


def _convert_with_pages(src: str, dest: str) -> bool:
    if not os.path.isdir("/Applications/Pages.app"):
        return False
    script = f'''
    set src to POSIX file "{src}"
    set dst to POSIX file "{dest}"
    tell application "Pages"
        set d to open src
        export d to dst as PDF
        close d saving no
    end tell
    '''
    try:
        r = subprocess.run(
            ["osascript", "-e", script], capture_output=True, timeout=120, text=True
        )
        return r.returncode == 0 and os.path.exists(dest)
    except (subprocess.SubprocessError, OSError):
        return False


def _convert_with_chrome(src: str, dest: str) -> bool:
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome):
        return False
    html = os.path.splitext(dest)[0] + ".html"
    try:
        subprocess.run(
            ["textutil", "-convert", "html", src, "-output", html],
            capture_output=True, timeout=60, check=True,
        )
        subprocess.run(
            [chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={dest}", f"file://{html}"],
            capture_output=True, timeout=120,
        )
        return os.path.exists(dest)
    except (subprocess.SubprocessError, OSError):
        return False


def staged_pdf(folder: str) -> str:
    return os.path.join(STAGE_DIR, re.sub(r"[^A-Za-z0-9]+", "_", folder) + ".pdf")


# --- commands ---------------------------------------------------------------


def cmd_map(dry_run: bool) -> int:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    data = build_map(conn)
    conn.close()

    matched = [e for e in data["entries"] if e["status"] == "matched"]
    low = [e for e in matched if e["score"] < 0.85 and e["reason"] != "override"]
    other = [e for e in data["entries"] if e["status"] != "matched"]

    for e in matched:
        f = e["files"]
        have = "".join(
            [
                "R" if f["resume"] else ("d" if f["docxResume"] else "-"),
                "C" if f["coverLetter"] else "-",
                "J" if f["jobDescription"] else "-",
            ]
        )
        print(f"  [{have}] {e['score']:.2f} {e['folder']}  ->  {e['company']} | {e['roleTitle']}")

    if low:
        print("\nlower confidence, worth a look:")
        for e in low:
            print(f"  {e['score']:.2f} {e['folder']}  ->  {e['company']} | {e['roleTitle']}")
    if other:
        print("\nno application of their own:")
        for e in other:
            spec = e.get("create")
            note = (
                f"create {spec['company']} | {spec['roleTitle']} ({spec['dateApplied']})"
                if spec else "skip, as agreed"
            )
            print(f"  {e['folder']}  ->  {note}")

    combined = [e for e in data["entries"] if e["files"]["combined"]]
    if combined:
        print("\ncombined resume+cover PDFs, left for you to file by hand:")
        for e in combined:
            for f in e["files"]["combined"]:
                print(f"  {e['folder']}/{f}")

    if not dry_run:
        with open(MAP_PATH, "w") as fh:
            json.dump(data, fh, indent=2)
        print(f"\nwrote {os.path.relpath(MAP_PATH, REPO_ROOT)}")
    created = len([e for e in other if e.get("create")])
    print(
        f"matched {len(matched)}, to create {created},"
        f" skipped {len(other) - created}, of {len(data['entries'])} folders"
    )
    return 0


def cmd_convert(dry_run: bool) -> int:
    data = load_map()
    todo = [
        e for e in data["entries"]
        if e["status"] in ("matched", "create")
        and not e["files"]["resume"]
        and e["files"]["docxResume"]
    ]
    if not dry_run:
        os.makedirs(STAGE_DIR, exist_ok=True)

    done = failed = 0
    for e in todo:
        src = os.path.join(ARCHIVE_DIR, e["folder"], e["files"]["docxResume"])
        dest = staged_pdf(e["folder"])
        if dry_run:
            print(f"  would convert {e['files']['docxResume']}  ({e['folder']})")
            done += 1
            continue
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"  present  {os.path.basename(dest)}")
            done += 1
            continue
        if convert_docx(src, dest):
            print(f"  ok       {os.path.basename(dest)}  ({os.path.getsize(dest):,} bytes)")
            done += 1
        else:
            print(f"  FAILED   {e['folder']}")
            failed += 1

    verb = "would convert" if dry_run else "converted"
    print(f"\n{verb} {done}, failed {failed}")
    return 1 if failed else 0


def resolve_row(conn, entry, dry_run):
    """The application an entry attaches to, creating it if that was agreed.

    Creation is matched on company + role + date before inserting, so a second
    run reuses the row the first run made instead of adding a duplicate.
    """
    if entry["status"] == "matched":
        return repo.get_application(conn, entry["applicationId"])
    spec = entry.get("create")
    if not spec:
        return None
    row = conn.execute(
        "SELECT id FROM applications WHERE company = ? AND role_title = ?"
        " AND date_applied = ?",
        (spec["company"], spec["roleTitle"], spec["dateApplied"]),
    ).fetchone()
    if row:
        return repo.get_application(conn, row["id"])
    if dry_run:
        print(f"  would create  {spec['company']} | {spec['roleTitle']} ({spec['dateApplied']})")
        return None
    app = repo.create_application(conn, {**spec, "archived": 1})
    conn.execute("UPDATE applications SET archived = 1 WHERE id = ?", (app["id"],))
    print(f"  created  {spec['company']} | {spec['roleTitle']} ({spec['dateApplied']})")
    return repo.get_application(conn, app["id"])


def attach(conn, app, entry, dry_run, counts):
    """Attach a folder's documents to one application. Never overwrites."""
    folder = os.path.join(ARCHIVE_DIR, entry["folder"])
    label = f"{app['company']} | {app['roleTitle']}"
    files = entry["files"]
    skipped = failed = 0

    for kind, name in ((af.RESUME, files["resume"]), (af.COVER_LETTER, files["coverLetter"])):
        if repo.get_attachment_path(conn, app["id"], kind):
            skipped += 1
            continue
        source, original = (os.path.join(folder, name), name) if name else (None, None)
        if kind is af.RESUME and not name and files["docxResume"]:
            staged = staged_pdf(entry["folder"])
            if os.path.exists(staged) and os.path.getsize(staged) > 0:
                source = staged
                original = os.path.splitext(files["docxResume"])[0] + ".pdf"
        if not source:
            continue
        try:
            with open(source, "rb") as fh:
                payload = fh.read()
        except OSError as err:
            print(f"  FAILED   {label} {kind.key}: {err}")
            failed += 1
            continue
        if not af.looks_like_pdf(payload, original):
            print(f"  FAILED   {label} {kind.key}: {original} is not a PDF")
            failed += 1
            continue
        if len(payload) > af.MAX_BYTES:
            print(f"  FAILED   {label} {kind.key}: {original} exceeds the size limit")
            failed += 1
            continue
        if dry_run:
            print(f"  would attach {kind.key:12} {label}  <- {original}")
            counts[kind.key] += 1
            continue
        stored, size = af.save(kind, app, payload)
        if repo.set_attachment(
            conn, app["id"], kind, stored, original, size, af.extract_text(payload)
        ) is None:
            print(f"  FAILED   {label} {kind.key}: row vanished mid-update")
            failed += 1
            continue
        print(f"  attached {kind.key:12} {label}  <- {original}")
        counts[kind.key] += 1

    # The posting has no attachment kind, so it lands as text.
    jd = files["jobDescription"]
    if jd:
        if (app.get("jobDescription") or "").strip():
            return skipped + 1, failed
        try:
            with open(os.path.join(folder, jd), "rb") as fh:
                text = af.extract_text(fh.read())
        except OSError as err:
            print(f"  FAILED   {label} job description: {err}")
            return skipped, failed + 1
        if not text:
            print(f"  no text  {label}: {jd} has no text layer")
            return skipped, failed
        if dry_run:
            print(f"  would fill  job desc     {label}  <- {jd} ({len(text):,} chars)")
        else:
            conn.execute(
                "UPDATE applications SET job_description = ?, updated_at = ? WHERE id = ?",
                (text, repo.now_iso(), app["id"]),
            )
            print(f"  filled   job desc     {label}  <- {jd} ({len(text):,} chars)")
        counts["job-description"] += 1
    return skipped, failed


def cmd_apply(dry_run: bool) -> int:
    data = load_map()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    counts = {"resume": 0, "cover-letter": 0, "job-description": 0}
    skipped = failed = 0

    for entry in data["entries"]:
        if entry["status"] == "skip":
            continue
        app = resolve_row(conn, entry, dry_run)
        if app is None:
            if entry["status"] == "matched":
                print(f"  FAILED   {entry['folder']}: application is gone")
                failed += 1
            continue
        s, f = attach(conn, app, entry, dry_run, counts)
        skipped += s
        failed += f

    if not dry_run:
        conn.commit()
    conn.close()

    verb = "would attach" if dry_run else "attached"
    print(
        f"\n{verb} {counts['resume']} resumes, {counts['cover-letter']} cover letters,"
        f" {counts['job-description']} job descriptions"
        f" — skipped {skipped} already filled, failed {failed}"
    )
    return 1 if failed else 0


def load_map() -> dict:
    if not os.path.exists(MAP_PATH):
        sys.exit("no archive_map.json — run `backfill_archive.py map` first")
    with open(MAP_PATH) as fh:
        return json.load(fh)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    command = args[0] if args else ""

    if not os.path.isdir(ARCHIVE_DIR):
        sys.exit(f"no archive at {ARCHIVE_DIR}")

    if command == "map":
        return cmd_map(dry_run)
    if command == "convert":
        return cmd_convert(dry_run)
    if command == "apply":
        return cmd_apply(dry_run)
    sys.exit(__doc__.strip())


if __name__ == "__main__":
    sys.exit(main())
