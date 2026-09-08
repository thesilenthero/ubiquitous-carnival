"""The two AI calls: read a posting into form fields, and score it against the
evaluation rubric.

Both are suggest-only. `extract_fields` produces a draft the user edits before
anything is saved; `score_posting` produces slider positions the user can move.
Neither touches the database.
"""
from typing import Optional

from pydantic import BaseModel

from . import ai
from .domain import SALARY_PERIODS, WORK_MODES, classify_role_type
from .evaluation import DIMENSION_KEYS, FLAG_KEYS, flags_text, rubric_text

# Mirrors INDUSTRIES / ROLE_TYPES in web/src/types.ts — the value has to be one
# of these to round-trip into the Analytics breakdown.
#
# These are *not* modelled as Literal/enum fields. The SDK's schema transform
# demotes an enum to a plain string with the values moved into the field's
# `description`, so the API does not enforce it — an off-list answer would come
# back and fail validation. The lists are stated in the prompt and enforced here
# in `_coerce`, which is the only place that can actually guarantee it.
INDUSTRIES = [
    "Financial Services",
    "Tech & Telecom",
    "Public Sector & Regulated",
    "Corporate / Enterprise",
    "Professional Services & Other",
]

ROLE_TYPES = [
    "Analyst",
    "Manager",
    "Lead",
    "Specialist",
    "Consultant",
    "Leadership",
    "Data Science",
    "Engineering",
    "Other",
]


class ExtractedFields(BaseModel):
    """What a job posting can tell us about the application record."""

    company: Optional[str]
    roleTitle: Optional[str]
    location: Optional[str]
    # Free-form on the way out of the model and snapped onto WORK_MODES /
    # SALARY_PERIODS below. A typed enum here would not actually constrain the
    # output — see the note on INDUSTRIES further down.
    workMode: Optional[str]
    salaryMin: Optional[float]
    salaryMax: Optional[float]
    salaryPeriod: Optional[str]
    industry: Optional[str]
    roleType: Optional[str]


def _coerce(value: Optional[str], allowed: list[str]) -> Optional[str]:
    """Snap a free-text answer onto the closed list, or drop it.

    Dropping beats keeping a near-miss: a null leaves the dropdown empty for the
    user to set, whereas "Tech and Telecom" would silently become its own
    category in the Analytics breakdown.
    """
    if not value:
        return None
    match = next((a for a in allowed if a.casefold() == value.strip().casefold()), None)
    return match


_EXTRACT_SYSTEM = """\
You read job postings and pull out the facts a job-application tracker records.

Rules:
- Report only what the posting states. Leave a field null rather than guessing.
- salaryMin/salaryMax are the figures as the posting states them, in its own
  currency, as plain numbers ("$120,000 - $140,000" is 120000 and 140000;
  "$62.50/hr" is 62.5). A single figure with no range goes in both fields.
  Do NOT convert between hourly and annual — report the number as written and
  say which it is in salaryPeriod. A monthly or weekly rate: leave both null.
- salaryPeriod is "hour" for an hourly or contract rate and "year" for an annual
  salary. Null when there is no salary at all.
- workMode is "remote" for fully remote, "hybrid" for any split of home and
  office (including "3 days on site"), "onsite" for fully in-office. Null when
  the posting doesn't say — do not infer it from the location line alone.
- location is the posting's own wording ("Toronto, ON", "Remote - Canada").

industry must be exactly one of these strings, or null:
{industries}

roleType must be exactly one of these strings, or null:
{role_types}

Pick the closest bucket for each; do not invent a new label.
""".format(
    industries="\n".join(f"  {i}" for i in INDUSTRIES),
    role_types="\n".join(f"  {r}" for r in ROLE_TYPES),
)


def extract_fields(text: str, hints: dict) -> ExtractedFields:
    """Read application fields out of posting text.

    `hints` are facts an ATS API already established. They are passed to the
    model as context and re-applied afterwards, so a structured value always
    beats an inferred one.
    """
    known = (
        "\n".join(f"- {k}: {v}" for k, v in hints.items())
        if hints
        else "(nothing — read everything from the posting)"
    )
    prompt = (
        f"Already known from the job board:\n{known}\n\n"
        f"Job posting:\n\n{text}"
    )
    fields = ai.parse_into(
        ExtractedFields, _EXTRACT_SYSTEM, prompt, effort="low", max_tokens=4000
    )

    merged = fields.model_dump()
    merged["industry"] = _coerce(merged.get("industry"), INDUSTRIES)
    merged["roleType"] = _coerce(merged.get("roleType"), ROLE_TYPES)
    merged["workMode"] = _coerce(merged.get("workMode"), WORK_MODES)
    merged["salaryPeriod"] = _coerce(merged.get("salaryPeriod"), SALARY_PERIODS)
    # A rate with no period is ambiguous ($65 vs $65,000), and the size of the
    # number is the only honest signal left. Full-time salaries do not run to
    # three digits, and contract rates do not run to five.
    if merged.get("salaryPeriod") is None and merged.get("salaryMin") is not None:
        merged["salaryPeriod"] = "hour" if merged["salaryMin"] < 1000 else "year"
    for key, value in hints.items():
        if value is not None and key in merged:
            merged[key] = value
    # The boards report a plain remote/not boolean. True is unambiguous; false
    # only rules out fully-remote, so it is dropped rather than guessed at.
    if hints.get("remote"):
        merged["workMode"] = "remote"
    # Same fallback the New-application form applies on blur.
    if not merged.get("roleType") and merged.get("roleTitle"):
        merged["roleType"] = classify_role_type(merged["roleTitle"])
    return ExtractedFields(**merged)


# --- Scoring --------------------------------------------------------------


class DimensionRating(BaseModel):
    score: int
    rationale: str


# One fixed property per dimension rather than a list of {key, score} objects.
# A list keyed by an enum is not actually constrained (see the note on
# INDUSTRIES above) — the model can emit an unknown key or an extra entry, which
# then fails validation on the way back. Fixed property names are enforced,
# because `required` and `additionalProperties: false` survive the transform.
class RubricScores(BaseModel):
    screening: DimensionRating
    roleType: DimensionRating
    wlb: DimensionRating
    technical: DimensionRating
    seniority: DimensionRating
    domain: DimensionRating
    alignment: DimensionRating


class RejectFlags(BaseModel):
    engagementMismatch: bool
    overtime: bool
    credentialGate: bool
    peopleManagement: bool


class ScoredEvaluation(BaseModel):
    scores: RubricScores
    flags: RejectFlags
    conclusion: str


# The schema above hardcodes the key names, so fail loudly at import time if the
# rubric in evaluation.py ever gains or renames a dimension.
assert list(RubricScores.model_fields) == DIMENSION_KEYS, (
    "RubricScores is out of sync with DIMENSIONS in server/evaluation.py"
)
assert list(RejectFlags.model_fields) == FLAG_KEYS, (
    "RejectFlags is out of sync with REJECT_FLAGS in server/evaluation.py"
)


_SCORE_SYSTEM = f"""\
You score job postings against one candidate's personal evaluation rubric. The
candidate is a senior analytics professional targeting stable decision-support
work — internal analytics that informs decisions, not client-facing delivery.
The rubric's anchors encode that preference; apply them as written rather than
scoring the role's general quality.

Score every one of these seven dimensions 0-10 using its anchors:

{rubric_text()}

For each dimension give a one-or-two-sentence rationale citing what in the
posting drove the score. Quote the posting's own language where it is the
evidence. Where the posting is silent on what a dimension measures, say so and
score the midpoint rather than assuming the best case.

Then judge each of these reject-fast flags true or false. They are advisory and
do not change the numeric scores — set one true only on positive evidence in the
text, not on absence of reassurance:

{flags_text()}

Finally write a 2-4 sentence conclusion: is this a fit today, is it
strategically useful long-term, and does it improve or worsen the path toward
stable decision-support work?
"""


def score_posting(
    text: str, company: Optional[str], role_title: Optional[str]
) -> dict:
    """Score a posting against the rubric.

    Returns the `Evaluation` shape the frontend uses, minus `composite` and
    `verdict` — those stay computed in web/src/lib/evaluation.ts so the math has
    exactly one home.
    """
    header = " ".join(p for p in (role_title, f"at {company}" if company else "") if p)
    prompt = (
        (f"Role: {header}\n\n" if header.strip() else "")
        + f"Job posting:\n\n{text}"
    )
    result = ai.parse_into(
        ScoredEvaluation, _SCORE_SYSTEM, prompt, effort="high", max_tokens=8000
    )

    scores: dict[str, int] = {}
    notes: dict[str, str] = {}
    for key in DIMENSION_KEYS:
        rating: DimensionRating = getattr(result.scores, key)
        # The schema pins the keys but not the range, so clamp here.
        scores[key] = max(0, min(10, int(rating.score)))
        if rating.rationale.strip():
            notes[key] = rating.rationale.strip()

    return {
        "scores": scores,
        "notes": notes,
        "flags": {k: bool(getattr(result.flags, k)) for k in FLAG_KEYS},
        "conclusion": result.conclusion.strip(),
    }
