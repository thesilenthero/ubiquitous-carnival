"""What to do next — plays computed from the pipeline, never stored.

The rest of the app records what happened. This module is the only place that
argues about what *should* happen: it reads the same event log everything else
reads and proposes concrete moves, ranked.

Two rules keep it from becoming noise:

  **One play per application.** A role that has been silent for ninety days is
  not simultaneously "nudge your contact" and "call it ghosted" — it is one
  situation, so `_application_play` is a cascade and the first match wins.

  **Acting on a play removes it.** The verb attached to most of these writes a
  real `next_action`, which is exactly the condition that makes the play stop
  firing. Suggestions drain into the follow-up queue rather than accumulating
  beside it.

Nothing here writes to the stage log, and nothing is persisted except a snooze.
"""
import datetime as dt
import re
import sqlite3
import urllib.parse

from . import activity
from .contacts import list_contacts
from .domain import (
    INTERVIEW_STAGES,
    PRE_STAGES,
    STAGE_LABELS,
    TERMINAL_STAGES,
    parse_ts,
)
from .repo import list_applications
from .settings_store import get_settings

# A docketed role you haven't decided on in this long is a decision you're
# avoiding — postings expire whether or not you got round to them.
DOCKET_STALE_DAYS = 14
# A networking contact goes cold faster than an application does: there is no
# process keeping the thread warm, only you.
COLD_CONTACT_DAYS = 30
# A thank-you note is worth sending for about this long after the conversation.
THANK_YOU_WINDOW_DAYS = 2
# "Not now" means a week, not forever — the situation usually changes.
SNOOZE_DAYS = 7

# Lower sorts first. The ordering is the opinion: a live conversation going
# cold outranks a cold application, and both outrank tidying.
PRIORITY = {
    "interview-prep": 5,
    "offer-decision": 10,
    "thank-you": 20,
    "revive": 30,
    "nudge-contact": 40,
    "ghost-it": 45,
    "linkedin-outreach": 50,
    "docket-decide": 60,
    "no-next-step": 70,
    "cold-contact": 80,
    "weekly-pace": 90,
}

_COMPANY_NOISE = re.compile(
    r"\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc)\b"
)


def _norm_company(name: str | None) -> str:
    """Loose company key, so "Scotiabank Inc." finds a contact at "Scotiabank".

    Deliberately lossy — this only ever decides which of two phrasings of the
    same suggestion you see, never whether data is written.
    """
    s = (name or "").lower()
    s = _COMPANY_NOISE.sub(" ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def _age_days(ts: str | None) -> int | None:
    """Whole calendar days since `ts`, **negative when it is in the future**.

    Signed on purpose: a stage event may be dated ahead — recording a booked
    interview is how a screen gets scheduled — so anything that clamps this at
    zero reports a conversation that hasn't happened yet as having happened
    today. Compared as dates, not instants, so "tomorrow" is 1 regardless of
    the time of day either side.
    """
    if not ts:
        return None
    try:
        return (_today() - parse_ts(ts).date()).days
    except ValueError:
        return None


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def _linkedin_people_search(company: str) -> str:
    q = urllib.parse.quote_plus(company)
    return f"https://www.linkedin.com/search/results/people/?keywords={q}"


def _step(
    play: str,
    subject_kind: str,
    subject_id: str,
    *,
    title: str,
    detail: str,
    link: str | None = None,
    external_url: str | None = None,
    action: str | None = None,
    stage: str | None = None,
    rank: float = 0,
) -> dict:
    return {
        # Stable across recomputes so a snooze keeps pointing at the same thing.
        "id": f"{play}:{subject_kind}:{subject_id}",
        "play": play,
        "priority": PRIORITY[play],
        "subjectKind": subject_kind,
        "subjectId": subject_id,
        "title": title,
        "detail": detail,
        "link": link,
        "externalUrl": external_url,
        # Prefill for the next action this play is arguing you should take.
        # None means the play has no single obvious follow-up to write down.
        "action": action,
        "stage": stage,
        # Tie-break within a priority band: staler first.
        "rank": rank,
    }


def _application_play(app: dict, ctx: dict) -> dict | None:
    """The single most useful thing to do about one application, or None.

    A cascade, not a filter chain: the first branch that matches wins, because
    an application is in exactly one situation at a time.
    """
    stage = app["currentStage"]
    quiet = _age_days(app["stageChangedAt"]) or 0
    quiet_days = ctx["quietDays"]
    company = app["company"]
    where = f"{company} · {app['roleTitle']}"
    link = f"/application/{app['id']}"
    has_action = bool(app.get("nextAction"))

    if stage == "offer":
        return _step(
            "offer-decision", "application", app["id"],
            title=f"Decide on the offer from {company}",
            detail=f"At offer for {quiet}d — the window won't stay open",
            link=link, stage=stage, rank=-quiet,
            action=f"Respond to {company}'s offer",
        )

    if stage in INTERVIEW_STAGES:
        # Dated ahead: the round is booked, not done. Nothing about a finished
        # interview applies yet — the only useful move is to prepare.
        if quiet < 0 and not has_action:
            away = -quiet
            when = "tomorrow" if away == 1 else f"in {away}d"
            return _step(
                "interview-prep", "application", app["id"],
                title=f"Prep for the {STAGE_LABELS[stage].lower()} at {company}",
                detail=f"Booked for {app['stageChangedAt'][:10]} — {when}",
                link=link, stage=stage, rank=away,
                action=f"Prep for {STAGE_LABELS[stage].lower()} — {where}",
            )
        # A note is only worth suggesting while it would still land as prompt,
        # and only if you haven't already logged something after the round.
        since_contact = ctx["lastInteractionDays"].get(app["id"])
        if (
            0 <= quiet <= THANK_YOU_WINDOW_DAYS
            and not has_action
            and (since_contact is None or since_contact > quiet)
        ):
            return _step(
                "thank-you", "application", app["id"],
                title=f"Send a thank-you after the {STAGE_LABELS[stage]} at {company}",
                detail=f"Interviewed {quiet}d ago, nothing logged since",
                link=link, stage=stage, rank=quiet,
                action=f"Send thank-you note — {where}",
            )
        if quiet > quiet_days:
            return _step(
                "revive", "application", app["id"],
                title=f"Revive the stalled conversation at {company}",
                detail=(
                    f"Reached {STAGE_LABELS[stage].lower()} and silent {quiet}d — "
                    "a live process going cold is worth more than a new application"
                ),
                link=link, stage=stage, rank=-quiet,
                action=f"Chase {company} for next steps",
            )
        if not has_action and quiet >= 0:
            return _step(
                "no-next-step", "application", app["id"],
                title=f"Decide the next step for {company}",
                detail=f"At {STAGE_LABELS[stage].lower()} with nothing scheduled",
                link=link, stage=stage, rank=-quiet,
                action=f"Follow up — {where}",
            )
        return None

    if stage == "applied":
        if quiet > quiet_days * 2:
            return _step(
                "ghost-it", "application", app["id"],
                title=f"Call {company} ghosted",
                detail=(
                    f"Applied {quiet}d ago, no response — closing it keeps your "
                    "response rate honest"
                ),
                link=link, stage=stage, rank=-quiet,
                action=None,
            )
        if quiet > quiet_days:
            contact = ctx["contactFor"](app)
            if contact:
                return _step(
                    "nudge-contact", "application", app["id"],
                    title=f"Ask {contact['name']} to flag your application at {company}",
                    detail=(
                        f"Quiet {quiet}d — you already know someone there, which "
                        "beats a cold approach"
                    ),
                    link=f"/contacts?open={contact['id']}",
                    external_url=contact.get("linkedinUrl"),
                    stage=stage, rank=-quiet,
                    action=f"Ask {contact['name']} to surface your application at {company}",
                )
            return _step(
                "linkedin-outreach", "application", app["id"],
                title=f"Find someone at {company} on LinkedIn",
                detail=(
                    f"Applied {quiet}d ago with no response and no contact there — "
                    "a recruiter or someone on the team can surface your candidacy"
                ),
                link=link,
                external_url=_linkedin_people_search(company),
                stage=stage, rank=-quiet,
                action=f"Reach out on LinkedIn about {where}",
            )
        return None

    if stage in PRE_STAGES:
        # The backstop the old docket list provided: anything wanted but not
        # scheduled. Aged ones sort first.
        if not app.get("nextActionDate"):
            age = _age_days(app.get("createdAt")) or 0
            stale = age >= DOCKET_STALE_DAYS
            return _step(
                "docket-decide", "application", app["id"],
                title=f"Apply or drop: {where}",
                detail=(
                    f"On the docket {age}d with no date set"
                    + (" — postings expire" if stale else "")
                ),
                link=link, stage=stage, rank=-age,
                action=f"Apply to {where}",
            )
        return None

    return None


# Reconnecting with everyone at once isn't a plan. Suggest a handful; the
# Contacts page is the complete list and always was.
MAX_COLD_CONTACTS = 5


def _contact_plays(contacts: list[dict]) -> list[dict]:
    out = []
    for c in contacts:
        if c.get("nextAction"):
            continue  # already on the follow-up queue
        since = _age_days(c.get("lastInteractionAt") or c.get("createdAt"))
        if since is None or since < COLD_CONTACT_DAYS:
            continue
        ever = bool(c.get("lastInteractionAt"))
        at = f" at {c['company']}" if c.get("company") else ""
        out.append(
            _step(
                "cold-contact", "contact", c["id"],
                title=f"Reconnect with {c['name']}{at}",
                detail=(
                    f"Last spoke {since}d ago" if ever
                    else f"Added {since}d ago, never contacted"
                ),
                link=f"/contacts?open={c['id']}",
                external_url=c.get("linkedinUrl"),
                # Warmest first, unlike every other play: these are ranked by
                # how revivable they are, not by how overdue they are.
                rank=since,
                action=f"Reach out to {c['name']}",
            )
        )
    out.sort(key=lambda s: s["rank"])
    return out[:MAX_COLD_CONTACTS]


def _pace_play(conn: sqlite3.Connection, weekly_target: int) -> dict | None:
    """One summary row when you're behind the week's target, never a nag when
    you're on it. Counts `applied` events, not rows created — the docket
    doesn't count until it's actually sent."""
    today = _today()
    monday = today - dt.timedelta(days=today.weekday())
    sent = conn.execute(
        "SELECT COUNT(DISTINCT application_id) AS n FROM stage_events "
        "WHERE stage = 'applied' AND occurred_at >= ? AND occurred_at < ?",
        (monday.isoformat(), (today + dt.timedelta(days=1)).isoformat()),
    ).fetchone()["n"]
    if sent >= weekly_target:
        return None
    short = weekly_target - sent
    left = 7 - today.weekday()
    return _step(
        "weekly-pace", "global", monday.isoformat(),
        title=f"{short} more application{'' if short == 1 else 's'} to hit this week's target",
        detail=f"{sent} of {weekly_target} sent since Monday · {left}d left in the week",
        link="/",
    )


def compute_next_steps(conn: sqlite3.Connection) -> list[dict]:
    """Every live play, most urgent first. Pure read — nothing is written."""
    settings = get_settings(conn)
    apps = list_applications(conn)
    contacts = list_contacts(conn)

    by_company: dict[str, dict] = {}
    by_id: dict[str, dict] = {}
    for c in contacts:
        by_id[c["id"]] = c
        key = _norm_company(c.get("company"))
        # First contact at a company wins; a tie here only picks which name the
        # suggestion shows, and the card lists them all anyway.
        if key and key not in by_company:
            by_company[key] = c

    def contact_for(app: dict) -> dict | None:
        # A linked referrer is a better answer than a company-name match.
        if app.get("contactId") and app["contactId"] in by_id:
            return by_id[app["contactId"]]
        return by_company.get(_norm_company(app.get("company")))

    last_interaction = {
        r["application_id"]: _age_days(r["last_at"])
        for r in conn.execute(
            "SELECT application_id, MAX(occurred_at) AS last_at FROM interactions "
            "WHERE application_id IS NOT NULL GROUP BY application_id"
        )
    }

    ctx = {
        "quietDays": settings["quietDays"],
        "contactFor": contact_for,
        "lastInteractionDays": last_interaction,
    }

    steps: list[dict] = []
    for app in apps:
        if app.get("archived") or app["currentStage"] in TERMINAL_STAGES:
            continue
        play = _application_play(app, ctx)
        if play:
            steps.append(play)

    steps.extend(_contact_plays(contacts))

    pace = _pace_play(conn, settings["weeklyTarget"])
    if pace:
        steps.append(pace)

    hidden = _snoozed_ids(conn)
    steps = [s for s in steps if s["id"] not in hidden]
    steps.sort(key=lambda s: (s["priority"], s["rank"], s["title"]))
    return steps


def _snoozed_ids(conn: sqlite3.Connection) -> set[str]:
    today = _today().isoformat()
    return {
        r["id"]
        for r in conn.execute(
            "SELECT id FROM next_step_snoozes WHERE until > ?", (today,)
        )
    }


def snooze(conn: sqlite3.Connection, step_id: str, days: int = SNOOZE_DAYS) -> dict:
    """Hide one play for a while. Not a dismissal: if the situation is still
    true when it lapses, the play comes back — which is the point."""
    until = (_today() + dt.timedelta(days=days)).isoformat()
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    conn.execute(
        """INSERT INTO next_step_snoozes (id, until, created_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET until = excluded.until""",
        (step_id, until, now),
    )
    activity.record(
        conn, "snooze", step_id, activity.CREATED,
        summary=f"Snoozed {step_id} until {until}",
        occurred_at=until,
    )
    return {"id": step_id, "until": until}
