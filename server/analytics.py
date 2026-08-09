"""Live analytics computed from the event log on every request — the port of
src/server's analytics.ts. Every figure is derived per-application from the
append-only stage_events log, so the numbers always reflect the live state.
"""
import datetime as dt
import math
import sqlite3
from typing import Optional

from .domain import FUNNEL_STAGES, TERMINAL_STAGES, parse_ts
from .settings_store import get_settings

DAY_MS = 24 * 60 * 60 * 1000


def _round1(n: float) -> float:
    # JS Math.round rounds .5 up; Python's round() banker-rounds. Match JS.
    return math.floor(n * 10 + 0.5) / 10


def _quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0
    pos = (len(sorted_vals) - 1) * q
    base = math.floor(pos)
    rest = pos - base
    if base + 1 < len(sorted_vals):
        return sorted_vals[base] + rest * (sorted_vals[base + 1] - sorted_vals[base])
    return sorted_vals[base]


def _monday_of(iso_date: str) -> str:
    d = dt.date.fromisoformat(iso_date)
    return (d - dt.timedelta(days=d.weekday())).isoformat()  # weekday(): Mon=0


def _ms(ts: str) -> float:
    return parse_ts(ts).timestamp() * 1000


def compute_analytics(
    conn: sqlite3.Connection,
    range_from: Optional[str] = None,
    range_to: Optional[str] = None,
) -> dict:
    apps = conn.execute(
        """SELECT id, source, industry, role_type, date_applied, created_at
           FROM applications"""
    ).fetchall()
    if range_from:
        apps = [a for a in apps if a["date_applied"] >= range_from]
    if range_to:
        apps = [a for a in apps if a["date_applied"] <= range_to]
    app_ids = {a["id"] for a in apps}
    events = [
        e
        for e in conn.execute(
            """SELECT application_id, stage, occurred_at FROM stage_events
               ORDER BY occurred_at ASC, id ASC"""
        )
        if e["application_id"] in app_ids
    ]

    # Group events per application (insertion order = chronological).
    by_app: dict[str, list[sqlite3.Row]] = {}
    for e in events:
        by_app.setdefault(e["application_id"], []).append(e)

    # "Ever reached" set of stages per application.
    reached_by_app = {
        app_id: {e["stage"] for e in evs} for app_id, evs in by_app.items()
    }

    def reached_count(stage: str) -> int:
        return sum(1 for s in reached_by_app.values() if stage in s)

    # ---- Funnel ----
    funnel = []
    for i, stage in enumerate(FUNNEL_STAGES):
        reached = reached_count(stage)
        if i == 0:
            funnel.append(
                {
                    "stage": stage,
                    "reached": reached,
                    "conversionFromPrev": None,
                    "dropOffFromPrev": None,
                }
            )
        else:
            prev = reached_count(FUNNEL_STAGES[i - 1])
            funnel.append(
                {
                    "stage": stage,
                    "reached": reached,
                    "conversionFromPrev": reached / prev if prev > 0 else None,
                    "dropOffFromPrev": prev - reached,
                }
            )

    applied_n = reached_count("applied")
    screen_n = reached_count("screen")
    screen_rate = screen_n / applied_n if applied_n > 0 else 0

    # ---- Response metrics ----
    # A "response" is the first event beyond the applied seed — a screen, an
    # interview, even a straight rejection. Ghosted does NOT count: it records
    # the absence of a reply, and counting it would peg the rate at 100%.
    responded = 0
    days_to_response: list[float] = []
    for evs in by_app.values():
        applied = next((e for e in evs if e["stage"] == "applied"), None)
        first = next(
            (e for e in evs if e["stage"] not in ("applied", "ghosted")), None
        )
        if not first:
            continue
        responded += 1
        if applied:
            days = (_ms(first["occurred_at"]) - _ms(applied["occurred_at"])) / DAY_MS
            if days >= 0:
                days_to_response.append(days)
    response_rate = responded / len(apps) if apps else 0
    days_to_response.sort()
    median_days_to_first_response = (
        _round1(_quantile(days_to_response, 0.5)) if days_to_response else None
    )

    # ---- Current-stage totals ----
    terminal = set(TERMINAL_STAGES)
    active = offers = rejected = ghosted = withdrawn = 0
    for evs in by_app.values():
        cur = evs[-1]["stage"]
        if cur == "offer":
            offers += 1
        if cur == "rejected":
            rejected += 1
        if cur == "ghosted":
            ghosted += 1
        if cur == "withdrawn":
            withdrawn += 1
        if cur not in terminal and cur != "offer":
            active += 1

    # ---- Dimension breakdowns (conversion, not just volume) ----
    def breakdown_by(key_of) -> list[dict]:
        m: dict[str, dict] = {}
        for app in apps:
            key = key_of(app)
            if not key:
                continue  # skip unclassified rows for this dimension
            reached = reached_by_app.get(app["id"], set())
            s = m.setdefault(key, {"applied": 0, "screen": 0, "offer": 0})
            s["applied"] += 1
            if "screen" in reached:
                s["screen"] += 1
            if "offer" in reached:
                s["offer"] += 1
        out = [
            {
                "key": key,
                "applied": s["applied"],
                "reachedScreen": s["screen"],
                "reachedOffer": s["offer"],
                "screenRate": s["screen"] / s["applied"] if s["applied"] else 0,
                "offerRate": s["offer"] / s["applied"] if s["applied"] else 0,
            }
            for key, s in m.items()
        ]
        out.sort(key=lambda x: -x["applied"])
        return out

    dimensions = {
        "industry": breakdown_by(lambda a: a["industry"]),
        "roleType": breakdown_by(lambda a: a["role_type"]),
    }

    # ---- Applications per week ----
    week_map: dict[str, int] = {}
    for app in apps:
        if not app["date_applied"]:
            continue
        wk = _monday_of(app["date_applied"])
        week_map[wk] = week_map.get(wk, 0) + 1
    per_week = [
        {"weekStart": wk, "count": n} for wk, n in sorted(week_map.items())
    ]

    # ---- Weekly pace vs. goal ----
    current_week_start = _monday_of(dt.datetime.now(dt.timezone.utc).date().isoformat())
    prev4 = [
        (dt.date.fromisoformat(current_week_start) - dt.timedelta(days=7 * i)).isoformat()
        for i in (1, 2, 3, 4)
    ]
    pace = {
        "target": get_settings(conn)["weeklyTarget"],
        "thisWeek": week_map.get(current_week_start, 0),
        "weekStart": current_week_start,
        "last4Avg": _round1(sum(week_map.get(wk, 0) for wk in prev4) / 4),
    }

    # ---- Time-in-stage distribution ----
    now_ms = dt.datetime.now(dt.timezone.utc).timestamp() * 1000
    durations: dict[str, list[float]] = {}
    for evs in by_app.values():
        for i, e in enumerate(evs):
            start = _ms(e["occurred_at"])
            is_last = i == len(evs) - 1
            end = now_ms if is_last else _ms(evs[i + 1]["occurred_at"])
            # Skip ongoing time for terminal stages — endpoints, not waits.
            if is_last and e["stage"] in terminal:
                continue
            days = max(0.0, (end - start) / DAY_MS)
            durations.setdefault(e["stage"], []).append(days)
    time_in_stage = []
    for stage in FUNNEL_STAGES:
        arr = sorted(durations.get(stage, []))
        avg = sum(arr) / len(arr) if arr else 0
        time_in_stage.append(
            {
                "stage": stage,
                "count": len(arr),
                "medianDays": _round1(_quantile(arr, 0.5)),
                "p75Days": _round1(_quantile(arr, 0.75)),
                "maxDays": _round1(arr[-1] if arr else 0),
                "avgDays": _round1(avg),
            }
        )

    return {
        "totals": {
            "applications": len(apps),
            "active": active,
            "offers": offers,
            "rejected": rejected,
            "ghosted": ghosted,
            "withdrawn": withdrawn,
        },
        "screenRate": screen_rate,
        "responseRate": response_rate,
        "medianDaysToFirstResponse": median_days_to_first_response,
        "funnel": funnel,
        "dimensions": dimensions,
        "perWeek": per_week,
        "timeInStage": time_in_stage,
        "pace": pace,
    }
