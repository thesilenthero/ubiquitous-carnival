"""Seeds a realistic sample pipeline so the analytics views are populated on a
fresh install — the port of src/server's seed.ts. Clears existing application
rows first. Run: npm run seed  (python3 -m server.seed)
"""
import datetime as dt

from .db import connect, init_schema
from .activity import using_source
from .repo import add_stage_event, create_application


def _days_ago(n: float) -> str:
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=n)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _date_days_ago(n: float) -> str:
    return _days_ago(n)[:10]


SEEDS = [
    dict(company="Stripe", role="Data Analyst, Payments", source="Referral",
         applied=45, remote=True, salaryMin=120000, salaryMax=150000,
         contact="Priya N.", referral="Former colleague",
         path=[("screen", 40), ("first-round", 33), ("later-round", 26),
               ("final", 18), ("offer", 12)],
         notes="Strong process. Offer under negotiation."),
    dict(company="Notion", role="Analytics Engineer", source="LinkedIn",
         applied=38, remote=True, salaryMin=130000, salaryMax=160000,
         path=[("screen", 34), ("first-round", 28), ("rejected", 21)],
         notes="Rejected after technical — SQL take-home was rough."),
    dict(company="Airbnb", role="Product Analyst", source="Indeed", applied=30,
         location="San Francisco, CA", salaryMin=125000, salaryMax=155000,
         path=[("screen", 25), ("first-round", 17), ("later-round", 9)],
         nextAction="Send thank-you note to panel", nextActionInDays=-1),
    dict(company="Datadog", role="BI Analyst", source="Recruiter", applied=28,
         remote=True, contact="Marcus (recruiter)", path=[("screen", 22)],
         nextAction="Prep for first round", nextActionInDays=2,
         notes="Waiting to hear back on scheduling."),
    dict(company="Figma", role="Data Scientist, Growth", source="Referral",
         applied=25, remote=True, referral="Bootcamp friend",
         path=[("screen", 20), ("first-round", 13), ("ghosted", 0)],
         notes="No response for 2+ weeks after first round."),
    dict(company="Shopify", role="Senior Data Analyst", source="LinkedIn",
         applied=21, remote=True, salaryMin=110000, salaryMax=140000,
         path=[("screen", 16)], nextAction="Complete SQL assessment",
         nextActionInDays=1),
    dict(company="Coinbase", role="Analytics Lead", source="Direct", applied=18,
         remote=True, path=[("rejected", 14)],
         notes="Auto-reject, likely seniority mismatch."),
    dict(company="Retool", role="Data Analyst", source="Indeed", applied=14,
         remote=False, location="New York, NY", path=[("screen", 9)],
         nextAction="Follow up with recruiter", nextActionInDays=-3),
    dict(company="Vanta", role="Business Analyst", source="LinkedIn", applied=10,
         remote=True, path=[], nextAction="No response yet — nudge",
         nextActionInDays=0),
    dict(company="Ramp", role="Data Analyst, Finance", source="Referral",
         applied=7, remote=True, referral="Ex-manager", path=[("screen", 3)],
         nextAction="Recruiter call Thursday", nextActionInDays=3),
    dict(company="Webflow", role="Marketing Analyst", source="Indeed", applied=5,
         remote=True, path=[]),
    dict(company="Linear", role="Product Data Analyst", source="Direct",
         applied=3, remote=True, path=[], notes="Dream company — small team."),
    dict(company="Brex", role="Analytics Engineer", source="Recruiter",
         applied=2, remote=True, contact="Dana (in-house recruiter)", path=[],
         nextAction="Send updated resume", nextActionInDays=1),
]


def main() -> None:
    import os
    import sys

    init_schema()
    conn = connect()
    # Guard: seeding DESTROYS all applications. Refuse to clobber a database
    # that holds more rows than the sample set unless explicitly forced.
    n = conn.execute("SELECT COUNT(*) AS n FROM applications").fetchone()["n"]
    if n > len(SEEDS) and os.environ.get("FORCE_SEED") != "1":
        conn.close()
        sys.exit(
            f"Refusing to seed: database already holds {n} applications "
            f"(seed would replace them with {len(SEEDS)} samples). "
            "Set FORCE_SEED=1 to override."
        )
    try:
        conn.execute("DELETE FROM stage_events")
        conn.execute("DELETE FROM applications")
        # The activity log carries no foreign key back to applications, which
        # is what lets a deletion entry outlive its subject — so a wipe has to
        # clear the application-scoped entries itself or they linger describing
        # rows that no longer exist. Contact and board history is untouched,
        # matching exactly what the wipe above covers.
        conn.execute("DELETE FROM activity WHERE application_id IS NOT NULL")
        # Sample data, tagged as such: 12 applications appearing in one second
        # are not 12 things you did, and the activity log should say so.
        with using_source("seed"):
            for s in SEEDS:
                app = create_application(
                    conn,
                    {
                        "company": s["company"],
                        "roleTitle": s["role"],
                        "source": s["source"],
                        "dateApplied": _date_days_ago(s["applied"]),
                        "workMode": "remote" if s.get("remote") else "hybrid",
                        "location": s.get("location"),
                        "salaryMin": s.get("salaryMin"),
                        "salaryMax": s.get("salaryMax"),
                        "salaryPeriod": s.get("salaryPeriod", "year"),
                        # The seed's `referral` values name a channel, which `source`
                        # already carries; only the person survives the merge.
                        "contactName": s.get("contact") or s.get("referral"),
                        "notes": s.get("notes"),
                        "nextAction": s.get("nextAction"),
                        "nextActionDate": (
                            _date_days_ago(-s["nextActionInDays"])
                            if "nextActionInDays" in s
                            else None
                        ),
                    },
                )
                for stage, d in s["path"]:
                    add_stage_event(conn, app["id"], stage, None, _days_ago(d))
        conn.commit()
    finally:
        conn.close()
    print(f"Seeded {len(SEEDS)} applications.")


if __name__ == "__main__":
    main()
