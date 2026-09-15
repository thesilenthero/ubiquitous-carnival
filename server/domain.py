"""Shared domain vocabulary — the Python port of src/server's domain.ts.

The stage list is deliberately ordered: the pre-stages sit before the funnel, the
funnel stages describe forward progression, and the terminal stages are exits from
it. Current stage is always DERIVED from the append-only stage_events log, never
stored as a mutable field.
"""
import datetime as dt
import re
from typing import Optional

# Roles you intend to apply to but haven't yet. Deliberately NOT part of the
# funnel: `applied` stays the funnel floor and index 0, so "top of funnel" keeps
# its meaning and every rate keeps its denominator. analytics.py excludes rows
# sitting at a pre-stage entirely — an un-applied role must not move the numbers.
PRE_STAGES = ["interested"]

FUNNEL_STAGES = [
    "applied",
    "screen",
    "first-round",
    "later-round",
    "final",
    "offer",
]

TERMINAL_STAGES = ["rejected", "withdrawn", "ghosted"]

ALL_STAGES = PRE_STAGES + FUNNEL_STAGES + TERMINAL_STAGES

# Stages that imply a conversation happened — recording one auto-creates an
# interview stub so the round can be annotated without re-entering the basics.
# A pre-stage must never appear here.
INTERVIEW_STAGES = ["screen", "first-round", "later-round", "final"]

STAGE_LABELS = {
    "interested": "Interested",
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


# --- Effort ----------------------------------------------------------------
# Everything above measures OUTCOMES. A week spent entirely preparing for two
# screens moves none of it, and so reads exactly like a week spent doing
# nothing. These weights measure INPUT instead: what the week actually cost,
# in units where one application sent = 1.
#
# The zeros are the load-bearing part. An offer or a rejection arriving is not
# something you did — scoring it would credit you for the week a company
# happened to reply. `interested` is 0 for the same reason it sits outside the
# funnel: docketing a role is a bookmark, not work.
STAGE_EFFORT = {
    "interested": 0,
    "applied": 1,
    "screen": 2,
    "first-round": 3,
    "later-round": 4,
    "final": 4,
    "offer": 0,
    "rejected": 0,
    "withdrawn": 0,
    "ghosted": 0,
}

# A flat rate rather than a per-kind map, because `interactions.kind` is free
# text: a map would be a map with a hole in it the first time you typed a kind
# nobody had thought of. Sending a message costs about what sending a message
# costs, whether you call it outreach or a follow-up.
#
# Half an application, matching the `networking` kind below. Not a claim that
# outreach is half the work — it is a claim about what it has been worth here,
# and the score is meant to reflect the search actually being run.
INTERACTION_EFFORT = 0.5

# Work that leaves no other record anywhere in the tracker — the reason this
# feature needs a table of its own rather than just a weighting of what is
# already logged. Preparing for a screen writes nothing: no stage moves, no
# contact is touched, no document is attached. Without these, the two days
# before an interview are indistinguishable from two days off.
#
# One entry means one session. There is no hours field on purpose: a duration
# is a decision every single time you log, and the weights already carry the
# only distinction that matters — a take-home is not a coffee chat.
EFFORT_KINDS = {
    "interview-prep": {
        "weight": 2, "label": "Interview prep", "category": "prep",
    },
    "take-home": {
        "weight": 4, "label": "Take-home / assessment", "category": "prep",
    },
    "application-prep": {
        "weight": 1, "label": "Tailoring resume / letter", "category": "prep",
    },
    "skill-practice": {
        "weight": 2, "label": "Skill practice", "category": "prep",
    },
    "research": {
        "weight": 1, "label": "Company / role research", "category": "prep",
    },
    # Half an application, deliberately: networking has not converted on this
    # search, and a score that priced it level with applying would keep
    # reporting good weeks for the activity that has produced least.
    # INTERACTION_EFFORT matches it, so both halves of the networking stack
    # move together.
    "networking": {
        "weight": 0.5, "label": "Networking event", "category": "networking",
    },
    "other": {"weight": 1, "label": "Other", "category": "prep"},
}

# The stacked segments of the weekly chart, in stack order. Deliberately four
# and not one-per-source: a stack with a segment per stage would be mostly
# zero-height slivers, and the per-item detail lives in the tooltip anyway.
EFFORT_CATEGORIES = {
    "applications": "Applications",
    "interviews": "Interviews",
    "prep": "Prep & practice",
    "networking": "Networking",
}

# Which category a scored stage event belongs to. Stages worth 0 never reach
# here, so only the stages that cost something need an entry.
STAGE_EFFORT_CATEGORY = {
    "applied": "applications",
    "screen": "interviews",
    "first-round": "interviews",
    "later-round": "interviews",
    "final": "interviews",
}


def is_effort_kind(v: object) -> bool:
    return isinstance(v, str) and v in EFFORT_KINDS


# Where the work happens. Hybrid is the default because it is the common
# arrangement for these roles — and because the honest answer for a posting
# that doesn't say is "probably hybrid", not "fully remote".
WORK_MODES = ["remote", "hybrid", "onsite"]
DEFAULT_WORK_MODE = "hybrid"

WORK_MODE_LABELS = {
    "remote": "Remote",
    "hybrid": "Hybrid",
    "onsite": "On-site",
}


def is_work_mode(v: object) -> bool:
    return isinstance(v, str) and v in WORK_MODES


# What a salary figure is denominated in. Contract roles quote an hourly rate,
# so the number alone is ambiguous — $65 and $65,000 are both plausible.
SALARY_PERIODS = ["year", "hour"]
DEFAULT_SALARY_PERIOD = "year"


def is_salary_period(v: object) -> bool:
    return isinstance(v, str) and v in SALARY_PERIODS


# Where the application came from. Suggestions, not a closed enum — the routes
# accept any non-empty string, and Discover writes the board's ATS name. What
# the list buys is consistent casing: `normalize_source` snaps whatever arrives
# onto the canonical spelling so the Pipeline column and the source filter don't
# split "referral" from "Referral". Keep in sync with web/src/types.ts.
SOURCES = [
    "LinkedIn",
    "Indeed",
    "Referral",
    "Recruiter",
    "Direct",
    "Company site",
    "Other",
]
# The UI's pick for a new application; the fallback for one that arrives without
# a source is "Other", since an unstated channel is unknown, not LinkedIn.
DEFAULT_SOURCE = "LinkedIn"
FALLBACK_SOURCE = "Other"

# Discover stores the board's ATS as the source; these are their display
# spellings. Keys match job_boards.ats (see discovery.py).
ATS_SOURCE_LABELS = {
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "ashby": "Ashby",
    "smartrecruiters": "SmartRecruiters",
    "workday": "Workday",
}

# Every spelling we know, folded for lookup. Built once — this runs on every write.
_SOURCE_BY_FOLD = {s.casefold(): s for s in [*SOURCES, *ATS_SOURCE_LABELS.values()]}


def normalize_source(v: object) -> Optional[str]:
    """Snap a source onto its canonical casing, or pass it through as typed.

    Unlike extract._coerce, an unrecognized value is kept rather than dropped:
    source is free text by design, and someone who types "Hiring event" should
    keep it. Only the casing of the known spellings is enforced.
    """
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    return _SOURCE_BY_FOLD.get(s.casefold(), s)


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
