"""Tiny key/value settings store — the port of src/server's settings.ts.

All settings are positive numbers with per-key defaults; unknown or invalid
stored values fall back to the default.
"""
import sqlite3

from . import activity

# key -> (default, min, max)
NUMERIC_SETTINGS: dict[str, tuple[float, float, float]] = {
    "weeklyTarget": (10, 1, 200),  # applications-per-week goal
    "staleDays": (14, 1, 365),     # Pipeline amber marker: early heads-up
    "quietDays": (30, 1, 365),     # Follow-ups "Gone quiet": time-to-ghost nudge
    # Analytics screen rate: how long an application must have been out before
    # a silence from it counts as "no screen". Below this it is still pending,
    # not a miss, so it stays out of the denominator entirely.
    "screenWindowDays": (14, 1, 365),
}


def _as_number(raw: str | None, default: float) -> float:
    try:
        n = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return n if n > 0 else default


def get_settings(conn: sqlite3.Connection) -> dict:
    raw = {
        r["key"]: r["value"]
        for r in conn.execute("SELECT key, value FROM settings")
    }
    out = {}
    for key, (default, _lo, _hi) in NUMERIC_SETTINGS.items():
        n = _as_number(raw.get(key), default)
        # Integers stay integers in JSON (matches the TS behavior of Number()).
        out[key] = int(n) if n == int(n) else n
    return out


def update_settings(conn: sqlite3.Connection, patch: dict) -> dict:
    before = get_settings(conn)
    for key in NUMERIC_SETTINGS:
        if key in patch and patch[key] is not None:
            conn.execute(
                """INSERT INTO settings (key, value) VALUES (?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
                (key, str(patch[key])),
            )
    after = get_settings(conn)
    changes = activity.diff(before, after, NUMERIC_SETTINGS)
    if changes:
        # Worth logging because these thresholds move the numbers: a stale-days
        # change makes the Pipeline read differently with no data behind it.
        activity.record(
            conn, "settings", "settings", activity.UPDATED,
            summary="Changed " + ", ".join(sorted(changes)),
            changes=changes,
        )
    return after
