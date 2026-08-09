"""Applications, stage events, and interviews — the port of src/server's repo.ts.

Responses are hand-built dicts with the exact camelCase keys the frontend
expects; every function takes an explicit connection (see db.get_db).
"""
import json
import sqlite3
from typing import Any, Optional

from .domain import INTERVIEW_STAGES
from .ids import nanoid, now_iso

# Editable scalar fields (everything except the derived stage and identity).
EDITABLE = {
    "company": "company",
    "roleTitle": "role_title",
    "source": "source",
    "dateApplied": "date_applied",
    "location": "location",
    "remote": "remote",
    "salaryMin": "salary_min",
    "salaryMax": "salary_max",
    "contactName": "contact_name",
    "referralSource": "referral_source",
    "industry": "industry",
    "roleType": "role_type",
    "jobUrl": "job_url",
    "jobDescription": "job_description",
    "resumeText": "resume_text",
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
        "questions": r["questions"],
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
        "remote": bool(r["remote"]),
        "salaryMin": r["salary_min"],
        "salaryMax": r["salary_max"],
        "contactName": r["contact_name"],
        "referralSource": r["referral_source"],
        "industry": r["industry"],
        "roleType": r["role_type"],
        "jobUrl": r["job_url"],
        "jobDescription": r["job_description"],
        "resumeText": r["resume_text"],
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
    id, company, role_title, source, date_applied, location, remote,
    salary_min, salary_max, contact_name, referral_source, industry, role_type,
    job_url, job_description, resume_text, notes, next_action,
    next_action_date, archived, eval_composite, eval_verdict, evaluation,
    created_at, updated_at
  ) VALUES (
    :id, :company, :role_title, :source, :date_applied, :location, :remote,
    :salary_min, :salary_max, :contact_name, :referral_source, :industry, :role_type,
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
    questions, notes, created_at, updated_at
  ) VALUES (
    :id, :application_id, :stage_event_id, :date, :format, :interviewers,
    :questions, :notes, :created_at, :updated_at
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
            "source": inp.get("source") or "other",
            "date_applied": inp["dateApplied"],
            "location": inp.get("location"),
            "remote": 1 if inp.get("remote") else 0,
            "salary_min": inp.get("salaryMin"),
            "salary_max": inp.get("salaryMax"),
            "contact_name": inp.get("contactName"),
            "referral_source": inp.get("referralSource"),
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
    conn.execute(
        _INSERT_EVENT,
        {
            "id": nanoid(),
            "application_id": app_id,
            "stage": stage,
            "note": None,
            "occurred_at": stage_at,
        },
    )
    return get_application(conn, app_id)  # type: ignore[return-value]


def update_application(
    conn: sqlite3.Connection, app_id: str, patch: dict
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    sets: list[str] = []
    params: dict[str, Any] = {"id": app_id}
    for key, col in EDITABLE.items():
        if key in patch:
            val = patch[key]
            if key in ("remote", "archived"):
                val = 1 if val else 0
            elif key == "evaluation" and val is not None:
                val = json.dumps(val)
            sets.append(f"{col} = :{col}")
            params[col] = val
    if sets:
        params["updated_at"] = now_iso()
        sets.append("updated_at = :updated_at")
        conn.execute(
            f"UPDATE applications SET {', '.join(sets)} WHERE id = :id", params
        )
    return get_application(conn, app_id)


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
    if stage in INTERVIEW_STAGES:
        now = now_iso()
        conn.execute(
            _INSERT_INTERVIEW,
            {
                "id": nanoid(),
                "application_id": app_id,
                "stage_event_id": event_id,
                "date": at[:10],
                "format": None,
                "interviewers": None,
                "questions": None,
                "notes": None,
                "created_at": now,
                "updated_at": now,
            },
        )
    conn.execute(
        "UPDATE applications SET updated_at = ? WHERE id = ?", (now_iso(), app_id)
    )
    return get_application(conn, app_id)


def update_stage_event(
    conn: sqlite3.Connection, app_id: str, event_id: str, patch: dict
) -> Optional[dict]:
    """Edit an existing stage event — its date, stage, or note. Changing the
    date can reorder events and thus re-derive the current stage (intended)."""
    if not _app_exists(conn, app_id):
        return None
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
    return get_application(conn, app_id)


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
    conn.execute(
        """DELETE FROM interviews
           WHERE stage_event_id = ? AND application_id = ?
             AND format IS NULL AND interviewers IS NULL
             AND questions IS NULL AND notes IS NULL""",
        (event_id, app_id),
    )
    conn.execute(
        "DELETE FROM stage_events WHERE id = ? AND application_id = ?",
        (event_id, app_id),
    )
    return get_application(conn, app_id)


def delete_application(conn: sqlite3.Connection, app_id: str) -> bool:
    cur = conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
    return cur.rowcount > 0


# --- Interviews ----------------------------------------------------------

INTERVIEW_EDITABLE = {
    "date": "date",
    "format": "format",
    "interviewers": "interviewers",
    "questions": "questions",
    "notes": "notes",
}


def add_interview(
    conn: sqlite3.Connection, app_id: str, inp: dict
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    now = now_iso()
    conn.execute(
        _INSERT_INTERVIEW,
        {
            "id": nanoid(),
            "application_id": app_id,
            "stage_event_id": None,
            "date": inp.get("date") or now[:10],
            "format": inp.get("format"),
            "interviewers": inp.get("interviewers"),
            "questions": inp.get("questions"),
            "notes": inp.get("notes"),
            "created_at": now,
            "updated_at": now,
        },
    )
    return get_application(conn, app_id)


def update_interview(
    conn: sqlite3.Connection, app_id: str, interview_id: str, patch: dict
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
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
    return get_application(conn, app_id)


def delete_interview(
    conn: sqlite3.Connection, app_id: str, interview_id: str
) -> Optional[dict]:
    if not _app_exists(conn, app_id):
        return None
    conn.execute(
        "DELETE FROM interviews WHERE id = ? AND application_id = ?",
        (interview_id, app_id),
    )
    return get_application(conn, app_id)
