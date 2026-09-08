"""Activity-log routes — read-only.

Nothing writes through here. Entries are appended by the data layer as a side
effect of the write that caused them (see server/activity.py), so there is no
way to post an entry that didn't happen.
"""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ..activity import list_activity
from ..db import get_db
from ..domain import is_iso_date, is_iso_timestamp

router = APIRouter()

_ACTIONS = ("created", "updated", "deleted")
# Which of the two clocks a range filters on. The default answers "what did I
# hear this week"; `occurred` answers "what is on the calendar next week" over
# the very same rows, which is the distinction the whole log exists for.
_DATE_FIELDS = {"recorded": "recorded_at", "occurred": "occurred_at"}


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _valid_bound(value: str) -> bool:
    return is_iso_date(value) or is_iso_timestamp(value)


@router.get("/activity")
def get_activity(
    dateField: str = "recorded",
    # `from` is a Python keyword, so the query name is set by alias rather than
    # by the parameter — the URL still reads ?from=&to= like the analytics route.
    frm: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    entity: Optional[str] = None,
    action: Optional[str] = None,
    applicationId: Optional[str] = None,
    contactId: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = 200,
    conn: sqlite3.Connection = Depends(get_db),
):
    if dateField not in _DATE_FIELDS:
        return _err(400, f"invalid dateField: {dateField}")
    for name, value in (("from", frm), ("to", to)):
        if value and not _valid_bound(value):
            return _err(400, f"invalid {name}: {value}")
    if action and action not in _ACTIONS:
        return _err(400, f"invalid action: {action}")
    return list_activity(
        conn,
        date_field=_DATE_FIELDS[dateField],
        frm=frm,
        to=to,
        entity=entity,
        action=action,
        application_id=applicationId,
        contact_id=contactId,
        source=source,
        limit=limit,
    )
