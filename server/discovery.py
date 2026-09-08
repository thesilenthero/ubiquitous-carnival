"""Discovered-jobs inbox — postings found by polling tracked company boards.

Deliberately shaped like server/suggestions.py: an external process proposes,
you accept or dismiss, and nothing reaches the pipeline until you say so. The
difference is what "accept" means — here it creates an application.

`discovered_jobs` holds the machine-found pre-application state, and has to be
its own table: a polled posting is not yet anything you've chosen, and there are
far more of them than there are roles you care about. Once you do choose one,
`docket` or `apply` turns it into a real application — docketed rows sit at a
pre-stage and are excluded from every analytics figure, so an un-applied role
still cannot corrupt a rate metric.

Nothing here calls conn.commit() — the get_db dependency commits on the way out.
"""
import sqlite3
from typing import Optional

from . import activity, postings, repo
from .domain import normalize_source
from .ids import nanoid, now_iso, today_str

STATUSES = ("new", "saved", "dismissed", "docketed", "applied")


def _map_board(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "ats": r["ats"],
        "host": r["host"],
        "slug": r["slug"],
        "site": r["site"],
        "company": r["company"],
        "keywords": r["keywords"] or "",
        "active": bool(r["active"]),
        "lastCheckedAt": r["last_checked_at"],
        "lastError": r["last_error"],
        "createdAt": r["created_at"],
    }


def _map_job(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "boardId": r["board_id"],
        "externalId": r["external_id"],
        "jobUrl": r["job_url"],
        "company": r["company"],
        "roleTitle": r["role_title"],
        "location": r["location"],
        "remote": None if r["remote"] is None else bool(r["remote"]),
        "salaryMin": r["salary_min"],
        "salaryMax": r["salary_max"],
        "postedAt": r["posted_at"],
        "roleType": r["role_type"],
        "firstSeenAt": r["first_seen_at"],
        "status": r["status"],
        "applicationId": r["application_id"],
    }


# --- Boards ---------------------------------------------------------------


def list_boards(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM job_boards ORDER BY company COLLATE NOCASE")
    return [_map_board(r) for r in rows]


def create_board(conn: sqlite3.Connection, url: str, keywords: str, company: str = "") -> dict:
    """Add a board from a pasted careers URL.

    Raises postings.FetchError when the URL isn't a board we can read.
    """
    parsed = postings.parse_board_url(url)
    existing = conn.execute(
        "SELECT * FROM job_boards WHERE ats = ? AND slug = ? AND IFNULL(site,'') = ?",
        (parsed["ats"], parsed["slug"], parsed["site"] or ""),
    ).fetchone()
    if existing:
        # Adding the same board twice updates its keywords rather than erroring
        # — the same "re-running is a no-op" spirit as the suggestions inbox.
        conn.execute(
            "UPDATE job_boards SET keywords = ?, active = 1 WHERE id = ?",
            (keywords.strip(), existing["id"]),
        )
        return _map_board(
            conn.execute("SELECT * FROM job_boards WHERE id = ?", (existing["id"],)).fetchone()
        )

    bid = nanoid()
    conn.execute(
        """INSERT INTO job_boards
           (id, ats, host, slug, site, company, keywords, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)""",
        (
            bid,
            parsed["ats"],
            parsed["host"],
            parsed["slug"],
            parsed["site"],
            (company.strip() or parsed["company"]),
            keywords.strip(),
            now_iso(),
        ),
    )
    board = _map_board(
        conn.execute("SELECT * FROM job_boards WHERE id = ?", (bid,)).fetchone()
    )
    activity.record(
        conn, "board", bid, activity.CREATED,
        summary=f"Started watching {board['company']} ({board['ats']})",
    )
    return board


def delete_board(conn: sqlite3.Connection, board_id: str) -> bool:
    row = conn.execute(
        "SELECT company FROM job_boards WHERE id = ?", (board_id,)
    ).fetchone()
    cur = conn.execute("DELETE FROM job_boards WHERE id = ?", (board_id,))
    if cur.rowcount and row:
        activity.record(
            conn, "board", board_id, activity.DELETED,
            summary=f"Stopped watching {row['company']}",
        )
    return cur.rowcount > 0


# --- Refresh --------------------------------------------------------------


def refresh_boards(conn: sqlite3.Connection) -> dict:
    """Poll every active board and store postings whose title matches.

    A board that fails is recorded in its `last_error` and reported, but does
    not abort the batch — the same per-item error accumulation /api/import uses.
    """
    boards = [b for b in list_boards(conn) if b["active"]]
    added = 0
    errors: list[str] = []

    for board in boards:
        # Narrowing is entirely list_board's job: which strategy applies is ATS
        # knowledge (a searchable board queries every keyword server-side; the
        # rest are matched on title). Re-filtering here would undo that.
        try:
            rows = postings.list_board(board, board["keywords"])
        except Exception as e:  # noqa: BLE001 — one bad board must not stop the rest
            message = getattr(e, "message", None) or str(e)
            errors.append(f"{board['company']}: {message}")
            conn.execute(
                "UPDATE job_boards SET last_error = ?, last_checked_at = ? WHERE id = ?",
                (message[:300], now_iso(), board["id"]),
            )
            continue

        for r in rows:
            cur = conn.execute(
                """INSERT INTO discovered_jobs
                   (id, board_id, external_id, job_url, company, role_title,
                    location, remote, salary_min, salary_max, posted_at,
                    role_type, first_seen_at, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
                   ON CONFLICT(board_id, external_id) DO NOTHING""",
                (
                    nanoid(),
                    board["id"],
                    r["externalId"],
                    r["jobUrl"],
                    board["company"],
                    r["roleTitle"],
                    r.get("location"),
                    None if r.get("remote") is None else (1 if r["remote"] else 0),
                    r.get("salaryMin"),
                    r.get("salaryMax"),
                    r.get("postedAt"),
                    r.get("roleType"),
                    now_iso(),
                ),
            )
            added += cur.rowcount

        conn.execute(
            "UPDATE job_boards SET last_checked_at = ?, last_error = NULL WHERE id = ?",
            (now_iso(), board["id"]),
        )

    return {"checked": len(boards), "added": added, "errors": errors}


# --- The inbox ------------------------------------------------------------

# Postings already represented in the pipeline are hidden rather than deleted,
# so a job entered by hand doesn't also sit in the inbox asking to be applied to.
# Evaluated at read time so it stays correct as applications are added.
#
# Rows applied *through* this inbox are exempt: they carry an application_id, and
# without the exemption the whole `applied` view would filter itself empty.
_NOT_ALREADY_APPLIED = """
  AND (
    d.application_id IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM applications a
      WHERE a.job_url IS NOT NULL AND a.job_url = d.job_url
    )
  )
"""


def list_discovered(conn: sqlite3.Connection, status: str = "new") -> list[dict]:
    if status not in STATUSES:
        status = "new"
    rows = conn.execute(
        f"""SELECT d.* FROM discovered_jobs d
            WHERE d.status = ? {_NOT_ALREADY_APPLIED}
            ORDER BY d.first_seen_at DESC, d.role_title""",
        (status,),
    )
    return [_map_job(r) for r in rows]


def resolve_discovered(
    conn: sqlite3.Connection, job_id: str, action: str, today: Optional[str] = None
) -> Optional[dict]:
    """`save` / `dismiss` / `docket` / `apply`. None if the job doesn't exist.

    `today` is the caller's calendar day, used as the application date; it falls
    back to the server's UTC day when the caller doesn't supply one.
    """
    row = conn.execute("SELECT * FROM discovered_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None

    if action in ("apply", "docket"):
        # `docket` creates the same application `apply` does, but seeds the log
        # at `interested` instead — the posting becomes a real tracked row with
        # notes, attachments and an evaluation, without claiming it was sent.
        applying = action == "apply"
        # Idempotent, exactly as accept_suggestion is: a second click must not
        # create a second application.
        if row["status"] in ("applied", "docketed"):
            return _map_job(row)

        # The description is fetched now rather than at poll time — Workday's
        # list endpoint doesn't carry one, and fetching thousands of postings on
        # every refresh would be absurd. A failure here must not block the apply.
        description = None
        try:
            description = postings.fetch_posting(row["job_url"]).text or None
        except Exception:  # noqa: BLE001 — an application without a JD is fine
            pass

        board = conn.execute(
            "SELECT ats FROM job_boards WHERE id = ?", (row["board_id"],)
        ).fetchone()
        app = repo.create_application(
            conn,
            {
                "company": row["company"],
                "roleTitle": row["role_title"],
                "source": normalize_source(board["ats"]) if board else None,
                "dateApplied": today or today_str(),
                "location": row["location"],
                # A board that says "remote" means it; one that says otherwise
                # can't distinguish hybrid from on-site, so let the default stand.
                "workMode": "remote" if row["remote"] else None,
                "salaryMin": row["salary_min"],
                "salaryMax": row["salary_max"],
                "roleType": row["role_type"],
                "jobUrl": row["job_url"],
                "jobDescription": description,
                "initialStage": None if applying else "interested",
                "nextAction": None if applying else "Submit application",
            },
        )
        conn.execute(
            "UPDATE discovered_jobs SET status = ?, application_id = ? WHERE id = ?",
            ("applied" if applying else "docketed", app["id"], job_id),
        )
    elif action in ("save", "dismiss"):
        conn.execute(
            "UPDATE discovered_jobs SET status = ? WHERE id = ?",
            ("saved" if action == "save" else "dismissed", job_id),
        )
    else:
        return None

    # Only the act of resolving a posting is logged, never the polling that
    # found it: one refresh can add hundreds of rows, and burying a week of
    # real activity under machine finds would defeat the log.
    activity.record(
        conn, "posting", job_id, activity.UPDATED,
        summary=f"{action.capitalize()}d {row['role_title']} at {row['company']}",
        changes={"status": [row["status"], action]},
    )
    return _map_job(
        conn.execute("SELECT * FROM discovered_jobs WHERE id = ?", (job_id,)).fetchone()
    )
