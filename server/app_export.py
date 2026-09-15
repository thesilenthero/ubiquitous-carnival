"""One application as a single Markdown document — context to paste into an LLM.

The zip export answers "give me everything, as tables". This answers the
opposite question: "give me one job, as prose a model can read in one pass",
so a conversation about an interview or a follow-up starts with the whole
picture instead of whichever fields got copied by hand.

Two choices carry the format:

  Long documents go inside XML-style tags, not under a heading alone. A job
  description arrives with its own `#` headings and bullet lists; left bare it
  blends into this document's structure, and a model can no longer tell where
  the posting ends and the tracker's notes begin. Tags are unambiguous.

  Empty things are omitted, never printed as "None". A line saying a field is
  blank is noise the model has to read past, and it reads as a fact about the
  job ("no salary") when it is only a gap in the record.

People are limited to what is explicitly linked — the referrer and interactions
tagged to this application. Matching contacts by company name would pull in
people who have nothing to do with this role.
"""
import datetime as dt
import sqlite3
from typing import Optional

from . import effort, repo
from .contacts import get_contact
from .domain import STAGE_LABELS, WORK_MODE_LABELS
from .evaluation import DIMENSIONS, REJECT_FLAGS

_VERDICT_LABELS = {
    "apply": "Apply",
    "apply-eyes-open": "Apply with eyes open",
    "marginal": "Marginal",
    "skip": "Skip",
}


def _day(ts: Optional[str]) -> str:
    return (ts or "")[:10]


def _join(*parts: Optional[str], sep: str = " · ") -> str:
    return sep.join(p.strip() for p in parts if p and p.strip())


def _inline(text: Optional[str]) -> str:
    """A note flattened onto one line, so it cannot break out of its bullet."""
    return " ".join((text or "").split())


def _tail(note: Optional[str]) -> str:
    flat = _inline(note)
    return f" — {flat}" if flat else ""


def _money(n) -> str:
    return f"${n:,.0f}" if n == int(n) else f"${n:,.2f}"


def _salary(app: dict) -> Optional[str]:
    lo, hi = app.get("salaryMin"), app.get("salaryMax")
    if lo is None and hi is None:
        return None
    rng = (
        _money(lo) if lo is not None and lo == hi
        else f"{_money(lo)}–{_money(hi)}" if lo is not None and hi is not None
        else f"from {_money(lo)}" if lo is not None
        else f"up to {_money(hi)}"
    )
    return f"Salary: {rng} / {app.get('salaryPeriod') or 'year'}"


def _block(tag: str, text: Optional[str]) -> list[str]:
    return [f"<{tag}>", text.strip(), f"</{tag}>"] if text and text.strip() else []


def _summary(app: dict, referrer: Optional[dict]) -> list[str]:
    where = _join(
        app.get("location"), WORK_MODE_LABELS.get(app.get("workMode") or ""), sep=", "
    )
    lines = [
        f"Current stage: {STAGE_LABELS.get(app['currentStage'], app['currentStage'])}"
        f" (since {_day(app['stageChangedAt'])})",
        _join(
            f"Applied: {app['dateApplied']}",
            app.get("source") and f"Source: {app['source']}",
            where and f"Location: {where}",
        ),
        _join(
            _salary(app),
            app.get("industry") and f"Industry: {app['industry']}",
            app.get("roleType") and f"Role type: {app['roleType']}",
        ),
        app.get("jobUrl") and f"Posting: {app['jobUrl']}",
    ]
    if referrer:
        who = _join(referrer.get("roleTitle"), referrer.get("company"), sep=", ")
        lines.append(
            f"Referrer: {referrer['name']}"
            + (f" ({who})" if who else "")
            + (" — " + _join(referrer.get("email"), referrer.get("linkedinUrl"))
               if referrer.get("email") or referrer.get("linkedinUrl") else "")
        )
    elif app.get("contactName"):
        lines.append(f"Referrer: {app['contactName']}")
    if app.get("nextAction"):
        lines.append(
            f"Next action: {_inline(app['nextAction'])}"
            + (f" ({app['nextActionDate']})" if app.get("nextActionDate") else "")
        )
    if app.get("archived"):
        lines.append("Archived: yes")
    return [f"- {l}" for l in lines if l]


def _timeline(app: dict, interactions: list, entries: list[dict]) -> list[str]:
    # (sort key, line). Interviews are not here: each one already has a stage
    # event on this list, and their notes get a section of their own below.
    rows: list[tuple[str, str]] = []
    for e in app.get("events", []):
        rows.append((e["occurredAt"], _join(
            _day(e["occurredAt"]),
            f"Stage → {STAGE_LABELS.get(e['stage'], e['stage'])}",
        ) + _tail(e.get("note"))))
    for i in interactions:
        rows.append((i["occurred_at"], _join(
            _day(i["occurred_at"]),
            f"Interaction with {i['name']}"
            + (f", {i['role_title']}" if i["role_title"] else "")
            + f" ({i['kind']})",
        ) + _tail(i["note"])))
    for x in entries:
        rows.append((x["occurredAt"], _join(
            x["occurredAt"], f"Effort: {x['label']}",
        ) + _tail(x.get("note"))))
    return [f"- {line}" for _, line in sorted(rows, key=lambda r: r[0])]


def _interviews(app: dict) -> list[str]:
    stage_by_event = {e["id"]: e["stage"] for e in app.get("events", [])}
    out: list[str] = []
    rounds = sorted(app.get("interviews", []), key=lambda i: i.get("date") or "", reverse=True)
    for iv in rounds:
        stage = stage_by_event.get(iv.get("stageEventId") or "")
        title = _join(
            iv.get("date"),
            STAGE_LABELS.get(stage) if stage else "Interview",
            iv.get("format"),
        )
        out.append(f"### {title}")
        if iv.get("interviewers"):
            out.append(f"Interviewers: {iv['interviewers']}")
        out += _block("interview_notes", iv.get("notes")) or ["_No notes recorded._"]
        out.append("")
    return out


def _evaluation(ev: dict) -> list[str]:
    verdict = _VERDICT_LABELS.get(ev.get("verdict"), ev.get("verdict"))
    out = [f"Composite: {ev.get('composite')}/100 — {verdict}", ""]
    scores, notes = ev.get("scores") or {}, ev.get("notes") or {}
    for d in DIMENSIONS:
        note = (notes.get(d["key"]) or "").strip()
        out.append(
            f"- {d['label']} ({d['weightPct']}%): {scores.get(d['key'], 0)}/10"
            + (f" — {note}" if note else "")
        )
    flags = [f["label"] for f in REJECT_FLAGS if (ev.get("flags") or {}).get(f["key"])]
    if flags:
        out += ["", "Reject-fast flags: " + "; ".join(flags)]
    if (ev.get("conclusion") or "").strip():
        out += ["", ev["conclusion"].strip()]
    return out


def _document(title: str, tag: str, text, filename, uploaded_at) -> list[str]:
    heading = f"## {title}" + (
        f" ({_join(filename, uploaded_at and 'uploaded ' + _day(uploaded_at), sep=', ')})"
        if filename else ""
    )
    if text and text.strip():
        return [heading, *_block(tag, text), ""]
    if filename:
        return [heading, "_Attached, but the PDF has no text layer to include._", ""]
    return []


def build_application_export(conn: sqlite3.Connection, app_id: str) -> Optional[str]:
    app = repo.get_application(conn, app_id)
    if not app:
        return None
    referrer = get_contact(conn, app["contactId"]) if app.get("contactId") else None
    interactions = conn.execute(
        """SELECT i.kind, i.note, i.occurred_at, c.name, c.role_title
             FROM interactions i JOIN contacts c ON c.id = i.contact_id
            WHERE i.application_id = ?""",
        (app_id,),
    ).fetchall()
    entries = effort.list_entries(conn, application_id=app_id, limit=1000)

    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    out = [
        f"# {app['roleTitle']} — {app['company']}",
        f"_Exported from Job Tracker on {today}. Dates are ISO (YYYY-MM-DD)._",
        "",
        "## Summary",
        *_summary(app, referrer),
        "",
    ]
    timeline = _timeline(app, interactions, entries)
    if timeline:
        out += ["## Timeline", *timeline, ""]
    if app.get("interviews"):
        out += ["## Interviews", *_interviews(app)]
    if app.get("evaluation"):
        out += ["## Evaluation", *_evaluation(app["evaluation"]), ""]
    if (app.get("notes") or "").strip():
        out += ["## Notes", *_block("notes", app["notes"]), ""]
    if (app.get("jobDescription") or "").strip():
        out += ["## Job description", *_block("job_description", app["jobDescription"]), ""]
    out += _document(
        "Resume submitted", "resume",
        app.get("resumeText"), app.get("resumeFilename"), app.get("resumeUploadedAt"),
    )
    out += _document(
        "Cover letter submitted", "cover_letter",
        app.get("coverLetterText"), app.get("coverLetterFilename"),
        app.get("coverLetterUploadedAt"),
    )
    return "\n".join(out).rstrip() + "\n"
