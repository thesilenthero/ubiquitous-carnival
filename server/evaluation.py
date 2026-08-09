"""The job-evaluation rubric, server side.

This is a mirror of the dimension/flag definitions in
`web/src/lib/evaluation.ts` — **keep the two in sync**, the same way
`classify_role_type` is mirrored across domain.py, types.ts, and the import
script. The frontend owns the *math* (composite, verdict thresholds); this copy
exists only so the scoring prompt can quote the rubric back to the model.

Duplication is the deliberate choice over shipping the rubric from the browser
with each request: the anchors are the contract the scores mean, and a client
that could rewrite them could quietly change what a 7 means.
"""
from typing import Literal

DimensionKey = Literal[
    "screening", "roleType", "wlb", "technical", "seniority", "domain", "alignment"
]

FlagKey = Literal["engagementMismatch", "overtime", "credentialGate", "peopleManagement"]

# (key, label, weight %, blurb, [(range, anchor text)])
DIMENSIONS: list[dict] = [
    {
        "key": "screening",
        "label": "Screening Probability",
        "weightPct": 20,
        "blurb": "How likely you clear a resume screen and recruiter pre-screen.",
        "anchors": [
            ("9-10", "Clear match on title, YOE, tools, domain. No obvious gaps."),
            ("7-8", "Strong match with one minor gap (tool familiarity, sector)."),
            ("5-6", "Reasonable match but a meaningful gap in credentials, domain, or title level."),
            ("3-4", "Notable mismatch in seniority, technical requirements, or sector specificity."),
            ("0-2", "Likely screened immediately. Graduate credentials required or clearly mis-levelled."),
        ],
    },
    {
        "key": "roleType",
        "label": "Role Type Fit",
        "weightPct": 20,
        "blurb": "Decision-support/analytical mandate vs. client-relationship ownership (the engagement model).",
        "anchors": [
            ("9-10", "Core mandate is analytical. Success = insight quality and decision impact. No client relationship ownership."),
            ("7-8", "Primarily analytical. Some external visibility, but you don't own the relationship or get measured on engagement."),
            ("5-6", "Mixed. Analytical work with meaningful external relationship exposure or client-shaped outputs."),
            ("3-4", "Client relationship ownership is a core expectation; success partly defined by satisfaction/engagement."),
            ("0-2", "Fundamentally client-service. Recurring calls, engagement metrics, or relationship ownership are primary duties."),
        ],
    },
    {
        "key": "wlb",
        "label": "Work-Life Balance Risk",
        "weightPct": 20,
        "blurb": "Does the structure imply overwork or always-on expectations?",
        "anchors": [
            ("9-10", "Planning cycles, governance, or reporting cadences drive urgency. No client/revenue pressure."),
            ("7-8", "Normal corporate rhythms. Deadline pressure is cyclical and predictable."),
            ("5-6", "Ambiguous. Fast-paced framing or delivery exposure without explicit overwork signals."),
            ("3-4", '"Fast-paced", "wears many hats", or "thrives under pressure" language. Client/revenue urgency implied.'),
            ("0-2", "Explicit always-on signals: agency model, client-managed timelines, high-growth startup, relentless delivery."),
        ],
    },
    {
        "key": "technical",
        "label": "Technical Match",
        "weightPct": 15,
        "blurb": "Is applied analytics sufficient, or does it require advanced methods?",
        "anchors": [
            ("9-10", "SQL, BI tools, Python at Pandas level, structured reporting. Direct match."),
            ("7-8", "Core stack match with one modest gap (e.g. Power BI, Looker)."),
            ("5-6", "Applied analytics sufficient but role implies statistical modeling depth or ML familiarity."),
            ("3-4", "Role implies R, advanced regression, causal inference, or graduate-level methods."),
            ("0-2", "Data scientist, ML engineer, or quantitative analyst role. Hard mismatch."),
        ],
    },
    {
        "key": "seniority",
        "label": "Seniority Match",
        "weightPct": 10,
        "blurb": "Does the level align - by title, YOE, and scope?",
        "anchors": [
            ("9-10", "Direct match. Senior Analyst or Manager, 5-10 YOE, IC with leadership exposure."),
            ("7-8", "One level off in title but scope and YOE align."),
            ("5-6", "Overqualified (rejection risk) or modestly underqualified (gap in management or scope)."),
            ("3-4", "Clearly too junior or too senior."),
            ("0-2", "Not in the same tier."),
        ],
    },
    {
        "key": "domain",
        "label": "Domain Match",
        "weightPct": 10,
        "blurb": "Does the sector fit your experience and target positioning?",
        "anchors": [
            ("8-10", "Preferred: Big Five banks, insurers, telecoms, crown corps, utilities, pensions, large enterprise retail, healthcare admin, public sector."),
            ("6-8", "Acceptable: mid-tier financial services, enterprise CPG, mature tech with stable internal analytics."),
            ("4-6", "Marginal: high-growth tech, SaaS, retail media, ad-tech adjacent. Note the sector risk explicitly."),
            ("0-3", "Hard exclusion: agencies, quota-driven sales orgs, advertiser-facing platform analytics."),
        ],
    },
    {
        "key": "alignment",
        "label": "Long-term Strategic Alignment",
        "weightPct": 5,
        "blurb": "Does this build or undermine your trajectory toward stable decision-support work?",
        "anchors": [
            ("9-10", "Directly builds decision-support credibility, institutional brand, governance exposure, or seniority."),
            ("7-8", "Neutral to positive. Maintains trajectory even if not ideal."),
            ("5-6", "Ambiguous. Useful experience but could muddy the narrative."),
            ("3-4", "Likely pulls the narrative back toward execution, sales, or delivery."),
            ("0-2", "Actively undermines positioning. Would require re-explaining in future interviews."),
        ],
    },
]

REJECT_FLAGS: list[dict] = [
    {
        "key": "engagementMismatch",
        "label": "Engagement-model mismatch",
        "blurb": "Owns recurring client relationships AND is measured on engagement activity.",
    },
    {
        "key": "overtime",
        "label": "Institutional overtime implied",
        "blurb": '"Thrives under pressure", "wears many hats", "fast-paced", "always on", "high-growth".',
    },
    {
        "key": "credentialGate",
        "label": "Hard credential gate",
        "blurb": "Mandatory domain/credential/technical requirement likely to act as an ATS filter.",
    },
    {
        "key": "peopleManagement",
        "label": "People management is a core duty",
        "blurb": "Full performance-management accountability over 2+ direct reports as a primary duty.",
    },
]

DIMENSION_KEYS = [d["key"] for d in DIMENSIONS]
FLAG_KEYS = [f["key"] for f in REJECT_FLAGS]


def rubric_text() -> str:
    """The rubric as prompt text — every dimension with its weight and anchors."""
    blocks = []
    for d in DIMENSIONS:
        anchors = "\n".join(f"    {rng}: {text}" for rng, text in d["anchors"])
        blocks.append(
            f"{d['key']} — {d['label']} ({d['weightPct']}% of the composite)\n"
            f"  What it measures: {d['blurb']}\n"
            f"  Scoring anchors:\n{anchors}"
        )
    return "\n\n".join(blocks)


def flags_text() -> str:
    return "\n".join(f"{f['key']} — {f['label']}: {f['blurb']}" for f in REJECT_FLAGS)
