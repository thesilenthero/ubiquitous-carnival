"""ID + timestamp helpers shared across the backend.

The nanoid alphabet matches the JS `nanoid` package (and the copy the import
scripts have always used), so IDs generated here are indistinguishable from
the ones already in the database.
"""
import secrets
import datetime as dt

ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict"


def nanoid(n: int = 21) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def now_iso() -> str:
    """Millisecond-precision UTC timestamp with a Z suffix — the exact shape
    JS `new Date().toISOString()` produces, which the DB is full of."""
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def today_str() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
