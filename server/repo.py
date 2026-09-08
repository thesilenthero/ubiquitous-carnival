"""Applications, stage events, and interviews — the port of src/server's repo.ts.

Responses are hand-built dicts with the exact camelCase keys the frontend
expects; every function takes an explicit connection (see db.get_db).
"""
import datetime as dt
import hashlib
import json
import logging
import sqlite3
from typing import Any, Optional

from . import activity, attachment_files
from .attachment_files import Kind
from .domain import (
    DEFAULT_SALARY_PERIOD,
    DEFAULT_WORK_MODE,
    FALLBACK_SOURCE,
    INTERVIEW_STAGES,
    PRE_STAGES,
    normalize_source,
    parse_ts,
)
from .ids import nanoid, now_iso

log = logging.getLogger(__name__)

# Editable scalar fields (everything except the derived stage and identity).
EDITABLE = {
    "company": "company",
    "roleTitle": "role_title",
    "source": "source",
    "dateApplied": "date_applied",
    "location": "location",
    "workMode": "work_mode",
    "salaryMin": "salary_min",
    "salaryMax": "salary_max",
    "salaryPeriod": "salary_period",
    "contactName": "contact_name",
    "contactId": "contact_id",
    "industry": "industry",
    "roleType": "role_type",
    "jobUrl": "job_url",
    "jobDescription": "job_description",
    "resumeText": "resume_text",
    "coverLetterText": "cover_letter_text",
    "notes": "notes",
    "nextAction": "next_action",
    "nextActionDate": "next_action_date",
    "archived": "archived",
    "evalComposite": "eval_composite",
    "evalVerdict": "eval_verdict",
    "evaluation": "evaluation",
}

# Latest event per application, resolved by occurred_at then id as a stable
# tie-breaker. This is the derivation of "current stage" from the event log.
_LATEST_EVENT_FOR = """
  SELECT * FROM stage_events
  WHERE application_id = ?
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1
"""

_EVENTS_FOR = """
  SELECT * FROM stage_events WHERE application_id = ?
  ORDER BY occurred_at ASC, id ASC
"""

# Latest event for EVERY application in one query — used by the list path so
# it doesn't degrade into one lookup per row.
_LATEST_EVENT_PER_APP = """
  SELECT id, application_id, stage, note, occurred_at FROM (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY application_id ORDER BY occurred_at DESC, id DESC
    ) AS rn FROM stage_events
  ) WHERE rn = 1
"""

_INTERVIEWS_FOR = """
  SELECT * FROM interviews WHERE application_id = ?
  ORDER BY date ASC, created_at ASC
"""


def _label(app: dict) -> str:
    """How an application names itself in an activity summary. Denormalized
    into the log at write time so a deletion entry still reads afterwards."""
    return f"{app['roleTitle']} at {app['company']}"


def _event_row(conn: sqlite3.Connection, app_id: str, event_id: str):
    return conn.execute(
        "SELECT * FROM stage_events WHERE id = ? AND application_id = ?",
        (event_id, app_id),
    ).fetchone()


def _interview_row(conn: sqlite3.Connection, app_id: str, interview_id: str):
    return conn.execute(
        "SELECT * FROM interviews WHERE id = ? AND application_id = ?",
        (interview_id, app_id),
    ).fetchone()


def _map_event(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "applicationId": r["application_id"],
        "stage": r["stage"],
        "note": r["note"],
        "occurredAt": r["occurred_at"],
    }


def _map_interview(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "applicationId": r["application_id"],
        "stageEventId": r["stage_event_id"],
        "date": r["date"],
        "format": r["format"],
        "interviewers": r["interviewers"],
        "notes": r["notes"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


def _map_app(
    conn: sqlite3.Connection,
    r: sqlite3.Row,
    include_events: bool = False,
    latest_override: Optional[sqlite3.Row] = None,
) -> dict:
    latest = latest_override
    if latest is None:
        latest = conn.execute(_LATEST_EVENT_FOR, (r["id"],)).fetchone()
    app = {
        "id": r["id"],
        "company": r["company"],
        "roleTitle": r["role_title"],
        "source": r["source"],
        "dateApplied": r["date_applied"],
        "location": r["location"],
        "workMode": r["work_mode"] or DEFAULT_WORK_MODE,
        "salaryMin": r["salary_min"],
        "salaryMax": r["salary_max"],
        "salaryPeriod": r["salary_period"] or DEFAULT_SALARY_PERIOD,
        # The referrer. `contactId` links to a real contact when there is one;
        # `contactName` is what to show either way, so a person who isn't in
        # the contact list still has a name on the application.
        "contactName": r["contact_name"],
        "contactId": r["contact_id"],
        "industry": r["industry"],
        "roleType": r["role_type"],
        "jobUrl": r["job_url"],
        "jobDescription": r["job_description"],
        "resumeText": r["resume_text"],
        "coverLetterText": r["cover_letter_text"],
        # The attached PDFs. The `*Path` columns are deliberately not exposed —
        # they are an internal storage detail, and the client downloads by
        # application id and kind.
        "resumeFilename": r["resume_filename"],
        "resumeSize": r["resume_size"],
        "resumeUploadedAt": r["resume_uploaded_at"],
        "coverLetterFilename": r["cover_letter_filename"],
        "coverLetterSize": r["cover_letter_size"],
        "coverLetterUploadedAt": r["cover_letter_uploaded_at"],
        # The application's folder in the off-machine archive. Derived, claimed
        # on the first attachment, and never user-set — so it is not in EDITABLE.
        "backupDir": r["backup_dir"],
        "notes": r["notes"],
        "nextAction": r["next_action"],
        "nextActionDate": r["next_action_date"],
        "archived": bool(r["archived"]),
        "evalComposite": r["eval_composite"],
        "evalVerdict": r["eval_verdict"],
        "evaluation": json.loads(r["evaluation"]) if r["evaluation"] else None,
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "currentStage": latest["stage"] if latest else "applied",
        "stageChangedAt": latest["occurred_at"] if latest else r["created_at"],
    }
    if include_events:
        app["events"] = [
            _map_event(e) for e in conn.execute(_EVENTS_FOR, (r["id"],))
        ]
        app["interviews"] = [
            _map_interview(i) for i in conn.execute(_INTERVIEWS_FOR, (r["id"],))
        ]
    return app


def list_applications(conn: sqlite3.Connection) -> list[dict]:
    latest_by_app = {
        r["application_id"]: r for r in conn.execute(_LATEST_EVENT_PER_APP)
    }
    return [
        _map_app(conn, r, False, latest_by_app.get(r["id"]))
        for r in conn.execute("SELECT * FROM applications")
    ]


def get_application(conn: sqlite3.Connection, app_id: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM applications WHERE id = ?", (app_id,)
    ).fetchone()
    return _map_app(conn, row, True) if row else None


def _app_exists(conn: sqlite3.Connection, app_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM applications WHERE id = ?", (app_id,)
        ).fetchone()
        is not None
    )


_INSERT_APP = """
  INSERT INTO applications (
    id, company, role_title, source, date_applied, location, work_mode,
    salary_min, salary_max, salary_period, contact_name, contact_id, industry, role_type,
    job_url, job_description, resume_text, notes, next_action,
    next_action_date, archived, eval_composite, eval_verdict, evaluation,
    created_at, updated_at
  ) VALUES (
    :id, :company, :role_title, :source, :date_applied, :location, :work_mode,
    :salary_min, :salary_max, :salary_period, :contact_name, :contact_id, :industry, :role_type,
    :job_url, :job_description, :resume_text, :notes, :next_action,
    :next_action_date, 0, :eval_composite, :eval_verdict, :evaluation,
    :created_at, :updated_at
  )
"""

_INSERT_EVENT = """
  INSERT INTO stage_events (id, application_id, stage, note, occurred_at)
  VALUES (:id, :application_id, :stage, :note, :occurred_at)
"""

_INSERT_INTERVIEW = """
  INSERT INTO interviews (
    id, application_id, stage_event_id, date, format, interviewers,
    notes, created_at, updated_at
  ) VALUES (
    :id, :application_id, :stage_event_id, :date, :format, :interviewers,
    :notes, :created_at, :updated_at
  )
"""


def create_application(conn: sqlite3.Connection, inp: dict) -> dict:
    now = now_iso()
    app_id = nanoid()
    stage = inp.get("initialStage") or "applied"
    # Seed the event log at the application date (or an explicit time) so even
    # a brand-new record participates in the funnel from its first stage.
    stage_at = inp.get("initialStageAt") or (
        f"{inp['dateApplied']}T00:00:00.000Z" if inp.get("dateApplied") else now
    )
    evaluation = inp.get("evaluation")
    conn.execute(
        _INSERT_APP,
        {
            "id": app_id,
            "company": inp["company"],
            "role_title": inp["roleTitle"],
            "source": normalize_source(inp.get("source")) or FALLBACK_SOURCE,
            "date_applied": inp["dateApplied"],
            "location": inp.get("location"),
            "work_mode": inp.get("workMode") or DEFAULT_WORK_MODE,
            "salary_min": inp.get("salaryMin"),
            "salary_max": inp.get("salaryMax"),
            "salary_period": inp.get("salaryPeriod") or DEFAULT_SALARY_PERIOD,
            "contact_name": inp.get("contactName"),
            "contact_id": inp.get("contactId"),
            "industry": inp.get("industry"),
            "role_type": inp.get("roleType"),
            "job_url": inp.get("jobUrl"),
            "job_description": inp.get("jobDescription"),
            "resume_text": inp.get("resumeText"),
            "notes": inp.get("notes"),
            "next_action": inp.get("nextAction"),
            "next_action_date": inp.get("nextActionDate"),
            "eval_composite": inp.get("evalComposite"),
            "eval_verdict": inp.get("evalVerdict"),
            "evaluation": json.dumps(evaluation) if evaluation is not None else None,
            "created_at": now,
            "updated_at": now,
        },
    )
    event_id = nanoid()
    conn.execute(
        _INSERT_EVENT,
        {
            "id": event_id,
            "application_id": app_id,
            "stage": stage,
            "note": None,
            "occurred_at": stage_at,
        },
    )
    created = get_application(conn, app_id)
    # Two entries, because two things happened: a row appeared, and the log
    # started at a stage. The stage entry's occurred_at is the seed event's,
    # which for a back-dated import is nowhere near when it was typed.
    activity.record(
        conn, "application", app_id, activity.CREATED,
        summary=f"Added {_label(created)}",
        application_id=app_id,
        contact_id=inp.get("contactId"),
        occurred_at=inp["dateApplied"],
    )
    activity.record(
        conn, "stage_event", event_id, activity.CREATED,
        summary=f"Recorded {stage} for {_label(created)}",
        application_id=app_id,
        occurred_at=stage_at,
    )
    return created  # type: ignore[return-value]


def update_application(
    conn: sqlite3.Connection, app_id: str, patch: dict
) -> Optional[dict]:
    before = get_application(conn, app_id)
    if before is None:
        return None
    sets: list[str] = []
    params: dict[str, Any] = {"id": app_id}
    for key, col in EDITABLE.items():
        if key in patch:
            val = patch[key]
            if key == "archived":
                val = 1 if val else 0
            elif key == "evaluation" and val is not None:
                val = json.dumps(val)
            elif key == "source":
                # Canonical casing on the way in, so an edit can't reintroduce
                # the "referral"/"Referral" split the migration just closed.
                val = normalize_source(val) or FALLBACK_SOURCE
            sets.append(f"{col} = :{col}")
            params[col] = val
    if sets:
        params["updated_at"] = now_iso()
        sets.append("updated_at = :updated_at")
        conn.execute(
            f"UPDATE applications SET {', '.join(sets)} WHERE id = :id", params
        )
    after = get_application(conn, app_id)
    changes = activity.diff(before, after, EDITABLE)
    if changes and after:
        # occurred_at only when the edit moved a real-world date. Rescheduling
        # the next action is the case worth being able to ask about later;
        # renaming the company is not.
        activity.record(
            conn, "application", app_id, activity.UPDATED,
            summary=f"Edited {_label(after)}",
            application_id=app_id,
            contact_id=after.get("contactId"),
            changes=changes,
            occurred_at=(
                after.get("nextActionDate") if "nextActionDate" in changes else None
            ),
        )
    return after


def add_stage_event(
    conn: sqlite3.Connection,
    app_id: str,
    stage: str,
    note: Optional[str] = None,
    occurred_at: Optional[str] = None,
) -> Optional[dict]:
    """Record a stage transition. This APPENDS to the log — it never
    overwrites. Interview-type stages also spawn an interview stub (date
    prefilled from the event)."""
    if not _app_exists(conn, app_id):
        return None
    event_id = nanoid()
    at = occurred_at or now_iso()
    conn.execute(
        _INSERT_EVENT,
        {
            "id": event_id,
            "application_id": app_id,
            "stage": stage,
            "note": note,
            "occurred_at": at,
        },
    )
    stub_id: Optional[str] = None
    if stage in INTERVIEW_STAGES:
        now = now_iso()
        stub_id = nanoid()
        conn.execute(
            _INSERT_INTERVIEW,
            {
                "id": stub_id,
                "application_id": app_id,
                "stage_event_id": event_id,
                "date": at[:10],
                "format": None,
                "interviewers": None,
                "notes": None,
                "created_at": now,
                "updated_at": now,
            },
        )
    if stage == "applied" and not _has_applied_event(conn, app_id, event_id):
        # A role moves off the docket the first time it reaches `applied`. That
        # event's date IS the date applied, so it replaces the placeholder
        # written when the row was created. Guarded on "no earlier applied
        # event" so re-recording `applied` on a real application never rewrites
        # its date — and it never fires on the ordinary create path, which
        # inserts its seed event directly rather than through here.
        conn.execute(
            "UPDATE applications SET date_applied = ? WHERE id = ?",
            (at[:10], app_id),
        )
        _settle_docket_before(conn, app_id, at, event_id)
    conn.execute(
        "UPDATE applications SET updated_at = ? WHERE id = ?", (now_iso(), app_id)
    )
    app = get_application(conn, app_id)
    label = _label(app) if app else app_id
    # `at` is the caller's date and may be days out in either direction; the
    # log stamps its own recorded_at. Booking next Thursday's first round today
    # writes both entries as heard-today, scheduled-Thursday.
    activity.record(
        conn, "stage_event", event_id, activity.CREATED,
        summary=f"Recorded {stage} for {label}",
        application_id=app_id,
        occurred_at=at,
    )
    if stub_id:
        activity.record(
            conn, "interview", stub_id, activity.CREATED,
            summary=f"Interview stub for {label}",
            application_id=app_id,
            occurred_at=at[:10],
        )
    return app


def _has_applied_event(
    conn: sqlite3.Connection, app_id: str, exclude_event_id: str
) -> bool:
    row = conn.execute(
        """SELECT 1 FROM stage_events
           WHERE application_id = ? AND stage = 'applied' AND id != ?
           LIMIT 1""",
        (app_id, exclude_event_id),
    ).fetchone()
    return row is not None


def _settle_docket_before(
    conn: sqlite3.Connection, app_id: str, applied_at: str, event_id: str
) -> None:
    """Keep the docket event ahead of the application it led to.

    Current stage is whichever event sorts last, so back-dating an `applied`
    event to before the moment the role was docketed would leave the row
    reading as still-on-the-docket — while its date_applied said otherwise.

    You cannot apply to a role before you were interested in it, so the fix is
    to pull the docket event back to just before the apply rather than to
    reject the date. The entry is preserved; only its position is corrected.
    """
    stale = conn.execute(
        f"""SELECT id FROM stage_events
            WHERE application_id = ? AND id != ?
              AND stage IN ({",".join("?" * len(PRE_STAGES))})
              AND occurred_at >= ?""",
        (app_id, event_id, *PRE_STAGES, applied_at),
    ).fetchall()
    if not stale:
        return
    moved = parse_ts(applied_at) - dt.timedelta(milliseconds=1)
    moved_iso = moved.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moved.microsecond // 1000:03d}Z"
    for row in stale:
        conn.execute(
            "UPDATE stage_events SET occurred_at = ? WHERE id = ?",
            (moved_iso, row["id"]),
        )


def update_stage_event(
    conn: sqlite3.Connection, app_id: str, event_id: str, patch: dict
) -> Optional[dict]:
    """Edit an existing stage event — its date, stage, or note. Changing the
    date can reorder events and thus re-derive the current stage (intended)."""
    if not _app_exists(conn, app_id):
        return None
    row = _event_row(conn, app_id, event_id)
    before = _map_event(row) if row else None
    sets: list[str] = []
    params: dict[str, Any] = {"id": event_id, "app": app_id}
    if "stage" in patch:
        sets.append("stage = :stage")
        params["stage"] = patch["stage"]
    if "note" in patch:
        sets.append("note = :note")
        params["note"] = patch["note"]
    if "occurredAt" in patch:
        sets.append("occurred_at = :occurred_at")
        params["occurred_at"] = patch["occurredAt"]
    if sets:
        conn.execute(
            f"UPDATE stage_events SET {', '.join(sets)} WHERE id = :id AND application_id = :app",
            params,
        )
        conn.execute(
            "UPDATE applications SET updated_at = ? WHERE id = ?",
            (now_iso(), app_id),
        )
    app = get_application(conn, app_id)
    row = _event_row(conn, app_id, event_id)
    after = _map_event(row) if row else None
    changes = activity.diff(before, after, ("stage", "note", "occurredAt"))
    if changes and after:
        activity.record(
            conn, "stage_event", event_id, activity.UPDATED,
            summary=f"Edited {after['stage']} for {_label(app) if app else app_id}",
            application_id=app_id,
            changes=changes,
            occurred_at=after["occurredAt"],
        )
    return app


def delete_stage_event(
    conn: sqlite3.Connection, app_id: str, event_id: str
) -> Optional[dict]:
    """Delete a single stage event. Guarded so an application always retains
    at least one event. An auto-created interview stub goes with it, but only
    while still empty — filled-in notes survive."""
    n = conn.execute(
        "SELECT COUNT(*) AS n FROM stage_events WHERE application_id = ?",
        (app_id,),
    ).fetchone()["n"]
    if n <= 1:
        return get_application(conn, app_id)
    # Read both before the DELETE — afterwards there is nothing left to
    # describe, which is the whole reason the log denormalizes its summary.
    row = _event_row(conn, app_id, event_id)
    app = get_application(conn, app_id)
    label = _label(app) if app else app_id
    stubs = conn.execute(
        """SELECT id, date FROM interviews
           WHERE stage_event_id = ? AND application_id = ?
             AND format IS NULL AND interviewers IS NULL
             AND notes IS NULL""",
        (event_id, app_id),
    ).fetchall()
    conn.execute(
        """DELETE FROM interviews
           WHERE stage_event_id = ? AND application_id = ?
             AND format IS NULL AND interviewers IS NULL
             AND notes IS NULL""",
        (event_id, app_id),
    )
    conn.execute(
        "DELETE FROM stage_events WHERE id = ? AND application_id = ?",
        (event_id, app_id),
    )
    if row:
        activity.record(
            conn, "stage_event", event_id, activity.DELETED,
            summary=f"Removed {row['stage']} from {label}",
            application_id=app_id,
            occurred_at=row["occurred_at"],
        )
    for stub in stubs:
        activity.record(
            conn, "interview", stub["id"], activity.DELETED,
            summary=f"Removed interview stub from {label}",
            application_id=app_id,
            occurred_at=stub["date"],
        )
    return get_application(conn, app_id)


def delete_application(conn: sqlite3.Connection, app_id: str) -> bool:
    app = get_application(conn, app_id)
    cur = conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
    if cur.rowcount and app:
        # The cascade has just taken this application's stage events,
        # interviews, suggestions and attached PDFs with it. One entry stands
        # for all of it — and survives, because activity carries no foreign key
        # back.
        activity.record(
            conn, "application", app_id, activity.DELETED,
            summary=f"Deleted {_label(app)}",
            application_id=app_id,
            contact_id=app.get("contactId"),
            occurred_at=app.get("dateApplied"),
        )
    return cur.rowcount > 0


# --- PDF attachments ------------------------------------------------------
#
# One implementation for both kinds. The column names come from the frozen table
# in attachment_files, never from a request, which is what makes the f-string
# interpolation below safe.
#
# The bytes live in `attachment_blobs`, keyed by (application_id, kind); the
# metadata — filename, size, uploaded_at, extracted text — stays in its columns
# on `applications`, where _map_app already reads it. Nothing but the download
# route loads a blob, which is the point of the split (see db.py).


def has_attachment(conn: sqlite3.Connection, app_id: str, kind: Kind) -> bool:
    """Whether a document of this kind is attached, without reading it."""
    row = conn.execute(
        "SELECT 1 FROM attachment_blobs WHERE application_id = ? AND kind = ?",
        (app_id, kind.key),
    ).fetchone()
    return row is not None


def get_attachment_bytes(
    conn: sqlite3.Connection, app_id: str, kind: Kind
) -> Optional[tuple[bytes, str]]:
    """The stored PDF and its SHA-256, or None if nothing is attached.

    The hash comes back with the bytes because the download route serves it as
    the ETag — it is already stored, so this costs nothing.
    """
    row = conn.execute(
        "SELECT bytes, sha256 FROM attachment_blobs WHERE application_id = ? AND kind = ?",
        (app_id, kind.key),
    ).fetchone()
    return (row["bytes"], row["sha256"]) if row else None


def set_attachment(
    conn: sqlite3.Connection,
    app_id: str,
    kind: Kind,
    data: bytes,
    original_name: str,
    text: Optional[str],
) -> Optional[dict]:
    """Store an attached PDF, replacing whatever was there before.

    The blob and the metadata are written under one transaction: either the
    application row records a document and the document is there, or neither
    happened. There is no window in which one exists without the other.

    `text` overwrites the kind's text column only when extraction produced
    something — a scanned document with no text layer must not wipe text that
    was pasted by hand.
    """
    digest = hashlib.sha256(data).hexdigest()
    at = now_iso()
    sets = [
        f"{kind.filename_col} = :filename",
        f"{kind.size_col} = :size",
        f"{kind.uploaded_col} = :at",
        "updated_at = :at",
    ]
    params = {
        "id": app_id,
        "filename": original_name,
        "size": len(data),
        "at": at,
    }
    if text:
        sets.append(f"{kind.text_col} = :text")
        params["text"] = text

    with conn:
        cur = conn.execute(
            f"UPDATE applications SET {', '.join(sets)} WHERE id = :id", params
        )
        if not cur.rowcount:
            # The row vanished between the caller's lookup and this write. The
            # transaction rolls back, so no blob is left pointing at nothing.
            return None
        conn.execute(
            """INSERT INTO attachment_blobs
                 (application_id, kind, bytes, byte_size, sha256, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(application_id, kind) DO UPDATE SET
                 bytes = excluded.bytes, byte_size = excluded.byte_size,
                 sha256 = excluded.sha256, created_at = excluded.created_at""",
            (app_id, kind.key, data, len(data), digest, at),
        )

    app = get_application(conn, app_id)
    if app:
        _archive_attachment(conn, app, kind, data)
        app = get_application(conn, app_id)
    if app:
        activity.record(
            conn, "attachment", f"{app_id}:{kind.key}", activity.CREATED,
            summary=f"Attached {kind.label} to {_label(app)} ({original_name})",
            application_id=app_id,
        )
    return app


def _archive_attachment(
    conn: sqlite3.Connection, app: dict, kind: Kind, data: bytes
) -> None:
    """Copy the just-attached document into the off-machine archive.

    Best-effort by design. The database already holds the document by the time
    this runs, so a full disk or an unreachable iCloud folder must degrade the
    export, never fail the upload. `scripts/backup_attachments.py` re-syncs
    whatever was missed.

    The folder is claimed on the first attachment and reused forever after, so
    a resume and its cover letter stay together even if the company, role, or
    applied date is edited between the two uploads.
    """
    try:
        folder = app.get("backupDir") or attachment_files.backup_folder_name(app)
        if not attachment_files.mirror(kind, data, folder):
            return
        if not app.get("backupDir"):
            conn.execute(
                "UPDATE applications SET backup_dir = ? WHERE id = ?",
                (folder, app["id"]),
            )
    except Exception:  # noqa: BLE001 — a backup must not break an upload
        log.exception("Archiving the %s failed for %s", kind.label, app.get("id"))


def clear_attachment(
    conn: sqlite3.Connection, app_id: str, kind: Kind
) -> Optional[dict]:
    """Detach the PDF. The text column is left alone — it is the archival
    record of what went out. So is the copy in the iCloud archive."""
    with conn:
        cur = conn.execute(
            f"""UPDATE applications
                SET {kind.filename_col} = NULL, {kind.size_col} = NULL,
                    {kind.uploaded_col} = NULL, updated_at = ?
                WHERE id = ?""",
            (now_iso(), app_id),
        )
        if not cur.rowcount:
            return None
        conn.execute(
            "DELETE FROM attachment_blobs WHERE application_id = ? AND kind = ?",
            (app_id, kind.key),
        )

    app = get_application(conn, app_id)
    if app:
        activity.record(
            conn, "attachment", f"{app_id}:{kind.key}", activity.DELETED,
            summary=f"Detached {kind.label} from {_label(app)}",
            application_id=app_id,
        )
    return app


# --- Interviews ----------------------------------------------------------

INTERVIEW_EDITABLE = {
    "date": "date",
    "format": "format",
    "interviewers": "interviewers",
    "notes": "notes",
}


def add_interview(
    conn: sqlite3.Connection, app_id: str, inp: dict
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    now = now_iso()
    interview_id = nanoid()
    at = inp.get("date") or now[:10]
    conn.execute(
        _INSERT_INTERVIEW,
        {
            "id": interview_id,
            "application_id": app_id,
            "stage_event_id": None,
            "date": at,
            "format": inp.get("format"),
            "interviewers": inp.get("interviewers"),
            "notes": inp.get("notes"),
            "created_at": now,
            "updated_at": now,
        },
    )
    app = get_application(conn, app_id)
    if app:
        activity.record(
            conn, "interview", interview_id, activity.CREATED,
            summary=f"Added interview for {_label(app)}",
            application_id=app_id,
            occurred_at=at,
        )
    return app


def update_interview(
    conn: sqlite3.Connection, app_id: str, interview_id: str, patch: dict
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    row = _interview_row(conn, app_id, interview_id)
    before = _map_interview(row) if row else None
    sets: list[str] = []
    params: dict[str, Any] = {"id": interview_id, "app": app_id}
    for key, col in INTERVIEW_EDITABLE.items():
        if key in patch:
            sets.append(f"{col} = :{col}")
            params[col] = patch[key]
    if sets:
        params["updated_at"] = now_iso()
        sets.append("updated_at = :updated_at")
        conn.execute(
            f"UPDATE interviews SET {', '.join(sets)} WHERE id = :id AND application_id = :app",
            params,
        )
    app = get_application(conn, app_id)
    row = _interview_row(conn, app_id, interview_id)
    after = _map_interview(row) if row else None
    changes = activity.diff(before, after, INTERVIEW_EDITABLE)
    if changes and after:
        # A moved interview date is the edit most worth being able to replay:
        # occurred_at follows the new date, recorded_at says when it moved.
        activity.record(
            conn, "interview", interview_id, activity.UPDATED,
            summary=f"Edited interview for {_label(app) if app else app_id}",
            application_id=app_id,
            changes=changes,
            occurred_at=after.get("date"),
        )
    return app


def delete_interview(
    conn: sqlite3.Connection, app_id: str, interview_id: str
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    row = _interview_row(conn, app_id, interview_id)
    app = get_application(conn, app_id)
    conn.execute(
        "DELETE FROM interviews WHERE id = ? AND application_id = ?",
        (interview_id, app_id),
    )
    if row:
        activity.record(
            conn, "interview", interview_id, activity.DELETED,
            summary=f"Removed interview from {_label(app) if app else app_id}",
            application_id=app_id,
            occurred_at=row["date"],
        )
    return get_application(conn, app_id)
