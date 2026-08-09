"""Shared domain vocabulary — the Python port of src/server's domain.ts.

The stage list is deliberately ordered: the funnel stages describe forward
progression, the terminal stages are exits from it. Current stage is always
DERIVED from the append-only stage_events log, never stored as a mutable field.
"""
import datetime as dt
import re

FUNNEL_STAGES = [
    "applied",
    "screen",
    "first-round",
    "later-round",
    "final",
    "offer",
]

TERMINAL_STAGES = ["rejected", "withdrawn", "ghosted"]

ALL_STAGES = FUNNEL_STAGES + TERMINAL_STAGES

# Stages that imply a conversation happened — recording one auto-creates an
# interview stub so the round can be annotated without re-entering the basics.
INTERVIEW_STAGES = ["screen", "first-round", "later-round", "final"]

STAGE_LABELS = {
    "applied": "Applied",
    "screen": "Screen",
    "first-round": "First round",
    "later-round": "Later round",
    "final": "Final",
    "offer": "Offer",
    "rejected": "Rejected",
    "withdrawn": "Withdrawn",
    "ghosted": "Ghosted",
}


def is_stage(v: object) -> bool:
    return isinstance(v, str) and v in ALL_STAGES


def is_iso_date(v: object) -> bool:
    """An ISO calendar date (YYYY-MM-DD) that actually exists on the calendar."""
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return False
    try:
        dt.date.fromisoformat(v)
        return True
    except ValueError:
        return False


def is_iso_timestamp(v: object) -> bool:
    """Any ISO timestamp (stage events store full ISO timestamps with Z)."""
    if not isinstance(v, str):
        return False
    try:
        dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def parse_ts(v: str) -> dt.datetime:
    """Parse a stored ISO timestamp (or bare date) to an aware datetime."""
    parsed = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def classify_role_type(title: str) -> str:
    """Bucket a job title into a role type. Order matters: seniority/leadership
    terms win over the functional ones. Keep in sync with web/src/types.ts and
    scripts/import_sheet.py."""
    t = (title or "").lower()
    if re.search(r"director|head of|head,|chief|vp|vice president", t):
        return "Leadership"
    if re.search(r"\blead\b|lead,|lead$", t):
        return "Lead"
    if re.search(r"manager|management", t):
        return "Manager"
    if re.search(r"scientist|data science", t):
        return "Data Science"
    if re.search(r"engineer", t):
        return "Engineering"
    if re.search(r"analy(st|tics)", t):
        return "Analyst"
    if re.search(r"consultant", t):
        return "Consultant"
    if re.search(r"specialist", t):
        return "Specialist"
    return "Other"
