"""The effort score — what a week of searching actually cost.

Every other figure on the Analytics page measures an OUTCOME: applications
sent, screen rate, funnel conversion, days to first response. None of them
measure the work. Two days spent preparing for a screen move nothing on that
page, and so read exactly like two days off — which is the opposite of the
truth, and the reason this module exists.

The score has two halves, and it needs both:

  DERIVED   Things already in the log, weighted by what they cost rather than
            counted flat: applying is 1, a screen is 2, a later round is 4.
            (server/domain.py STAGE_EFFORT / INTERACTION_EFFORT.)
  LOGGED    Work that writes to nothing at all — prep, a take-home, an hour of
            practice. No derived metric can ever see it, because there is no
            row anywhere to derive it from. Hence `effort_entries`.

Scoring reads `stage_events` and `interactions` DIRECTLY rather than going
through the activity log, for three reasons: `activity` has no `stage` column,
some of its stage_event rows are orphaned (the event was later deleted or
edited), and most of them are `source='backfill'` rows whose `recorded_at` is a
guess. The source tables carry the real dates.

Which date: `occurred_at` throughout — the day the work happened, not the day
it was typed. Booking Thursday's first round on Monday credits Thursday, the
day you actually sit through it.
"""
import datetime as dt
import sqlite3
from typing import Optional

from . import activity
from .domain import (
    EFFORT_CATEGORIES,
    EFFORT_KINDS,
    INTERACTION_EFFORT,
    STAGE_EFFORT,
    STAGE_EFFORT_CATEGORY,
    STAGE_LABELS,
    is_effort_kind,
    is_iso_date,
)
from .ids import nanoid, now_iso


def _map(r: sqlite3.Row) -> dict:
    kind = EFFORT_KINDS.get(r["kind"], {})
    return {
        "id": r["id"],
        "kind": r["kind"],
        # Denormalized so a list render doesn't have to carry the weight table.
        "label": kind.get("label", r["kind"]),
        "weight": kind.get("weight", 0),
        "occurredAt": r["occurred_at"],
        "note": r["note"],
        "applicationId": r["application_id"],
        # NULL both when nothing was linked and when the linked application was
        # deleted — the entry survives either way, by design.
        "applicationLabel": (
            f"{r['role_title']} at {r['company']}" if r["company"] else None
        ),
        "createdAt": r["created_at"],
    }


_SELECT = """
  SELECT e.*, a.company, a.role_title
    FROM effort_entries e
    LEFT JOIN applications a ON a.id = e.application_id
"""


def list_entries(
    conn: sqlite3.Connection,
    *,
    frm: Optional[str] = None,
    to: Optional[str] = None,
    application_id: Optional[str] = None,
    limit: int = 100,
) -> list[dict]:
    """Newest first, by the day the work happened."""
    where: list[str] = []
    params: dict = {}
    if frm:
        where.append("e.occurred_at >= :frm")
        params["frm"] = frm
    if to:
        where.append("e.occurred_at <= :to")
        params["to"] = to
    if application_id:
        where.append("e.application_id = :application_id")
        params["application_id"] = application_id
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    params["limit"] = max(1, min(limit, 1000))
    rows = conn.execute(
        f"{_SELECT} {clause} ORDER BY e.occurred_at DESC, e.created_at DESC"
        " LIMIT :limit",
        params,
    ).fetchall()
    return [_map(r) for r in rows]


def get_entry(conn: sqlite3.Connection, entry_id: str) -> Optional[dict]:
    row = conn.execute(f"{_SELECT} WHERE e.id = :id", {"id": entry_id}).fetchone()
    return _map(row) if row else None


def create_entry(conn: sqlite3.Connection, inp: dict) -> Optional[dict]:
    """Log one session. Returns None if the kind or date won't do.

    `applicationId` is optional and is not required to exist: prep for a role
    you haven't entered yet is still prep. An id that names nothing simply
    leaves `applicationLabel` empty.
    """
    kind = inp.get("kind")
    if not is_effort_kind(kind):
        return None
    occurred_at = inp.get("occurredAt")
    if not is_iso_date(occurred_at):
        return None
    app_id = inp.get("applicationId") or None
    if app_id and not conn.execute(
        "SELECT 1 FROM applications WHERE id = ?", (app_id,)
    ).fetchone():
        app_id = None
    entry_id = nanoid()
    conn.execute(
        """INSERT INTO effort_entries
             (id, kind, occurred_at, note, application_id, created_at)
           VALUES (:id, :kind, :occurred_at, :note, :application_id, :created_at)""",
        {
            "id": entry_id,
            "kind": kind,
            "occurred_at": occurred_at,
            "note": (inp.get("note") or "").strip() or None,
            "application_id": app_id,
            "created_at": now_iso(),
        },
    )
    entry = get_entry(conn, entry_id)
    activity.record(
        conn, "effort", entry_id, activity.CREATED,
        summary=f"Logged {entry['label'].lower()}"
                + (f" for {entry['applicationLabel']}" if entry["applicationLabel"] else ""),
        application_id=app_id,
        # The day the work happened, so the entry answers a calendar question
        # the same way a booked interview does.
        occurred_at=occurred_at,
    )
    return entry


def delete_entry(conn: sqlite3.Connection, entry_id: str) -> bool:
    entry = get_entry(conn, entry_id)
    if not entry:
        return False
    conn.execute("DELETE FROM effort_entries WHERE id = ?", (entry_id,))
    activity.record(
        conn, "effort", entry_id, activity.DELETED,
        summary=f"Removed {entry['label'].lower()}"
                + (f" for {entry['applicationLabel']}" if entry["applicationLabel"] else ""),
        application_id=entry["applicationId"],
        occurred_at=entry["occurredAt"],
    )
    return True


# --- Scoring ---------------------------------------------------------------


def _scored_rows(conn: sqlite3.Connection) -> list[tuple]:
    """Every priced thing that ever happened, as (day, key, label, category, points).

    Note what is NOT here. Attachments are the largest single bucket of app
    activity in this database and are deliberately unscored: the metric would
    become a PDF counter, and tailoring is already priced into `applied = 1`.
    Nor is there any exclusion of docketed roles — the `_DOCKETED_IDS` guard in
    analytics.py protects funnel RATES from applications that were never sent,
    which has nothing to do with what a week cost. (`interested` is weight 0,
    so it changes no number either way; this is here so the omission reads as
    a decision rather than an oversight.)
    """
    out: list[tuple] = []

    for r in conn.execute("SELECT stage, occurred_at FROM stage_events"):
        points = STAGE_EFFORT.get(r["stage"], 0)
        if not points or not r["occurred_at"]:
            continue
        out.append((
            r["occurred_at"][:10],
            r["stage"],
            STAGE_LABELS.get(r["stage"], r["stage"]),
            STAGE_EFFORT_CATEGORY.get(r["stage"], "applications"),
            points,
        ))

    for r in conn.execute("SELECT kind, occurred_at FROM interactions"):
        if not r["occurred_at"]:
            continue
        kind = r["kind"] or "outreach"
        out.append((
            r["occurred_at"][:10],
            f"interaction:{kind}",
            kind.replace("-", " ").capitalize(),
            "networking",
            INTERACTION_EFFORT,
        ))

    for r in conn.execute("SELECT kind, occurred_at FROM effort_entries"):
        spec = EFFORT_KINDS.get(r["kind"])
        if not spec or not r["occurred_at"]:
            continue
        out.append((
            r["occurred_at"][:10],
            r["kind"],
            spec["label"],
            spec["category"],
            spec["weight"],
        ))

    return out


def score_per_week(
    conn: sqlite3.Connection,
    range_from: Optional[str] = None,
    range_to: Optional[str] = None,
    *,
    target: int,
) -> dict:
    """Weekly effort, bucketed by the day the work happened.

    The range bounds mean something different here than they do everywhere else
    on the Analytics page: there they filter applications by `date_applied`,
    here they bound the WEEKS the chart covers. Both are right for their own
    question and the UI says so out loud, because they cannot be read as the
    same filter.
    """
    # Imported here rather than at module scope: analytics.py imports this
    # module for its return payload, and the calendar helpers live over there
    # because `perWeek` already established what a week means on this page.
    from .analytics import _monday_of, _round1, _week_starts

    rows = _scored_rows(conn)
    if range_from:
        rows = [r for r in rows if r[0] >= range_from]
    if range_to:
        rows = [r for r in rows if r[0] <= range_to]

    # week -> {"total": n, category: n, "items": {key: {...}}}
    weeks: dict[str, dict] = {}
    for day, key, label, category, points in rows:
        wk = weeks.setdefault(
            _monday_of(day),
            {"total": 0, **{c: 0 for c in EFFORT_CATEGORIES}, "items": {}},
        )
        wk["total"] += points
        wk[category] += points
        item = wk["items"].setdefault(
            key, {"key": key, "label": label, "count": 0, "points": 0}
        )
        item["count"] += 1
        item["points"] += points

    current_week_start = _monday_of(
        dt.datetime.now(dt.timezone.utc).date().isoformat()
    )
    def week_row(wk: str) -> dict:
        w = weeks.get(wk)
        return {
            "weekStart": wk,
            "total": w["total"] if w else 0,
            **{c: (w[c] if w else 0) for c in EFFORT_CATEGORIES},
            # Biggest contributor first: the tooltip is there to explain where
            # a total came from, and the answer is usually its top line.
            "items": sorted(w["items"].values(), key=lambda i: -i["points"])
            if w
            else [],
        }

    # Walk the calendar, not the keys — a week you did nothing has to draw as a
    # zero, or a hiatus reads as sustained work. Same span rule as `perWeek` in
    # analytics.py, so the two charts sit on the same x-axis. An empty result
    # emits nothing at all, leaving the card its empty state rather than a flat
    # zero line across the whole window.
    per_week = [] if not weeks else [
        week_row(wk)
        for wk in _week_starts(
            _monday_of(range_from) if range_from else min(weeks),
            _monday_of(range_to)
            if range_to
            else max(current_week_start, max(weeks)),
        )
    ]

    prev4 = [
        (
            dt.date.fromisoformat(current_week_start) - dt.timedelta(days=7 * i)
        ).isoformat()
        for i in (1, 2, 3, 4)
    ]
    this_week = weeks.get(current_week_start, {}).get("total", 0)
    return {
        "perWeek": per_week,
        "thisWeek": this_week,
        "weekStart": current_week_start,
        "last4Avg": _round1(
            sum(weeks.get(wk, {}).get("total", 0) for wk in prev4) / 4
        ),
        "target": target,
        # Shipped so the chart can explain itself — the tooltip and the guide
        # read the weights from here rather than keeping a second copy that
        # drifts.
        "weights": {
            "stages": STAGE_EFFORT,
            "interaction": INTERACTION_EFFORT,
            "kinds": EFFORT_KINDS,
        },
        "categories": EFFORT_CATEGORIES,
    }
