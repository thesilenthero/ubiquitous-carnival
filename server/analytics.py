"""Live analytics computed from the event log on every request — the port of
src/server's analytics.ts. Every figure is derived per-application from the
append-only stage_events log, so the numbers always reflect the live state.
"""
import datetime as dt
import math
import sqlite3
from typing import Optional

from .domain import FUNNEL_STAGES, PRE_STAGES, TERMINAL_STAGES, parse_ts
from .settings_store import get_settings

DAY_MS = 24 * 60 * 60 * 1000

# Applications currently sitting at a pre-stage are excluded from every figure
# here: they haven't been applied to, so counting them would dilute each rate
# and their `date_applied` is a placeholder that must never reach the range
# filter below. The window mirrors repo._LATEST_EVENT_PER_APP exactly — same
# `occurred_at DESC, id DESC` tie-break — so "current stage" means the same
# thing in both places.
_DOCKETED_IDS = f"""
  SELECT application_id FROM (
    SELECT application_id, stage, ROW_NUMBER() OVER (
      PARTITION BY application_id ORDER BY occurred_at DESC, id DESC
    ) AS rn FROM stage_events
  ) WHERE rn = 1 AND stage IN ({",".join("?" * len(PRE_STAGES))})
"""


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


# Guards a malformed far-future range bound (routers/data.py validates the shape
# of `to`, not its magnitude) from spinning this loop.
_MAX_WEEKS = 520


def _week_starts(start: Optional[str], end: Optional[str]) -> list[str]:
    """Every Monday from `start` through `end`, inclusive."""
    if start is None or end is None or end < start:
        return []
    cur = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    out: list[str] = []
    while cur <= last and len(out) < _MAX_WEEKS:
        out.append(cur.isoformat())
        cur += dt.timedelta(days=7)
    return out


def _ms(ts: str) -> float:
    return parse_ts(ts).timestamp() * 1000


def compute_analytics(
    conn: sqlite3.Connection,
    range_from: Optional[str] = None,
    range_to: Optional[str] = None,
) -> dict:
    settings = get_settings(conn)
    apps = conn.execute(
        f"""SELECT id, source, industry, role_type, date_applied, created_at
            FROM applications
            WHERE id NOT IN ({_DOCKETED_IDS})""",
        PRE_STAGES,
    ).fetchall()
    docketed = conn.execute(
        f"SELECT COUNT(*) AS n FROM applications WHERE id IN ({_DOCKETED_IDS})",
        PRE_STAGES,
    ).fetchone()["n"]
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

    # Shared by everything below that measures elapsed time or asks whether an
    # application is finished.
    now_ms = dt.datetime.now(dt.timezone.utc).timestamp() * 1000
    terminal = set(TERMINAL_STAGES)

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

    # ---- Screen rate, over the applications old enough to judge ----
    # An application sent three days ago that hasn't heard back is not a miss;
    # it's pending. Counting it as a miss makes the rate sag every time you
    # have a productive week, which reads as the opposite of the truth. So the
    # denominator is the MATURED cohort only: an application counts once it has
    # either been answered (anything logged past the applied seed — a screen, a
    # rejection, a ghost you called) or sat out the screen window without one.
    # Everything younger and still silent is held back until it ages in.
    screen_window_days = settings["screenWindowDays"]
    undecided = {"applied", *PRE_STAGES}

    def applied_ms(app) -> Optional[float]:
        """When the clock started. The applied EVENT wins over the denormalized
        `date_applied` column: it carries a time of day, and it is what every
        other duration on this page is measured from."""
        ev = next(
            (e for e in by_app.get(app["id"], []) if e["stage"] == "applied"), None
        )
        if ev:
            return _ms(ev["occurred_at"])
        return _ms(app["date_applied"]) if app["date_applied"] else None

    def is_matured(app) -> bool:
        if reached_by_app.get(app["id"], set()) - undecided:
            return True  # already answered — the outcome is on the record
        t = applied_ms(app)
        if t is None:
            return True  # no date to hold it back by; don't silently drop it
        return (now_ms - t) / DAY_MS >= screen_window_days

    matured_ids = {a["id"] for a in apps if is_matured(a)}
    pending_n = len(apps) - len(matured_ids)
    screen_n = sum(
        1 for i in matured_ids if "screen" in reached_by_app.get(i, set())
    )
    screen_rate = screen_n / len(matured_ids) if matured_ids else 0

    # ---- Response metrics ----
    # A "response" is the first event beyond the applied seed — a screen, an
    # interview, even a straight rejection. Ghosted does NOT count: it records
    # the absence of a reply, and counting it would peg the rate at 100%. The
    # pre-stages don't count either, and for a subtler reason: a role that came
    # off the docket keeps its `interested` event, which sorts BEFORE the
    # applied seed, so it would otherwise be read as a reply that arrived
    # before the application went out.
    responded = 0
    days_to_response: list[float] = []
    for evs in by_app.values():
        applied = next((e for e in evs if e["stage"] == "applied"), None)
        first = next(
            (
                e
                for e in evs
                if e["stage"] not in ("applied", "ghosted", *PRE_STAGES)
            ),
            None,
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
            s = m.setdefault(
                key, {"applied": 0, "matured": 0, "screen": 0, "offer": 0}
            )
            s["applied"] += 1
            # Same split as the headline screen rate: `applied` stays the raw
            # volume the bars are drawn from, `matured` is what Screen % is
            # divided by, so a slice you've been hammering this week doesn't
            # look like your worst-converting one.
            if app["id"] in matured_ids:
                s["matured"] += 1
            if "screen" in reached:
                s["screen"] += 1
            if "offer" in reached:
                s["offer"] += 1
        out = [
            {
                "key": key,
                "applied": s["applied"],
                "maturedApplied": s["matured"],
                "reachedScreen": s["screen"],
                "reachedOffer": s["offer"],
                "screenRate": s["screen"] / s["matured"] if s["matured"] else 0,
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

    current_week_start = _monday_of(dt.datetime.now(dt.timezone.utc).date().isoformat())

    # ---- Applications per week ----
    week_map: dict[str, int] = {}
    for app in apps:
        if not app["date_applied"]:
            continue
        wk = _monday_of(app["date_applied"])
        week_map[wk] = week_map.get(wk, 0) + 1
    # Walk the calendar rather than the keys of week_map: a week nobody applied
    # in still needs a zero point, or a hiatus reads as continued activity.
    # `apps` is already range-filtered, so an empty week_map means nothing in
    # range at all -- emit nothing so the card keeps showing its empty state
    # rather than a flat zero line spanning the whole window.
    per_week = [] if not week_map else [
        {"weekStart": wk, "count": week_map.get(wk, 0)}
        for wk in _week_starts(
            _monday_of(range_from) if range_from else min(week_map),
            # Run to the current week, not the last week with data, so a dry
            # spell that reaches today shows as a decline instead of stopping.
            # max() keeps a future-dated application from being truncated off.
            _monday_of(range_to)
            if range_to
            else max(current_week_start, max(week_map)),
        )
    ]

    # ---- Weekly pace vs. goal ----
    prev4 = [
        (dt.date.fromisoformat(current_week_start) - dt.timedelta(days=7 * i)).isoformat()
        for i in (1, 2, 3, 4)
    ]
    pace = {
        "target": settings["weeklyTarget"],
        "thisWeek": week_map.get(current_week_start, 0),
        "weekStart": current_week_start,
        "last4Avg": _round1(sum(week_map.get(wk, 0) for wk in prev4) / 4),
    }

    # ---- Time-in-stage distribution ----
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
            # Roles on the docket. Counted separately and deliberately outside
            # the date range filter — a role you haven't applied to has no date
            # to filter on — and outside every rate above.
            "docketed": docketed,
        },
        "screenRate": screen_rate,
        # What the rate was actually computed over, so the UI can show its n
        # and name the applications it is deliberately not counting yet.
        "screenBasis": {
            "matured": len(matured_ids),
            "pending": pending_n,
            "reachedScreen": screen_n,
            "windowDays": screen_window_days,
        },
        "responseRate": response_rate,
        "medianDaysToFirstResponse": median_days_to_first_response,
        "funnel": funnel,
        "dimensions": dimensions,
        "perWeek": per_week,
        "timeInStage": time_in_stage,
        "pace": pace,
    }
