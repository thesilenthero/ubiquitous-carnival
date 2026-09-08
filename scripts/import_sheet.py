#!/usr/bin/env python3
"""
Import the "Job Search Tracker" Excel export into the app's SQLite database,
reconstructing a real stage-history event log from the sheet's per-stage dates.

Mapping (Applications sheet):
  Company            -> company
  Title              -> role_title
  Date applied       -> applied event (always)
  Initial screen     -> screen event      (if date present)
  Interview          -> first-round event (if date present)
  Rejection          -> rejected event    (if date present)
  Status "Dormant/no response" & no rejection -> ghosted event
  Priority + Category + first Response date  -> folded into notes (per user choice)
  source is left as "Other" (the sheet has no application-channel column)

This is destructive: it clears existing applications + stage_events, then loads
the sheet fresh. Re-run it whenever you re-export the spreadsheet.

Usage:
  python3 scripts/import_sheet.py "/path/to/Job Search Tracker.xlsx" [data/app.db]
"""
import os
import re
import sys
import sqlite3
import secrets
import datetime as dt

import openpyxl

ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict"


def nano(n: int = 21) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def iso_at(d: dt.datetime) -> str:
    """Midnight-UTC ISO timestamp for a sheet date (matches app convention)."""
    return dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def date_str(d: dt.datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"


def classify_role_type(title: str) -> str:
    """Bucket a title into a role type. Keep in sync with classifyRoleType in
    src/server/domain.ts and web/src/types.ts."""
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


def main() -> None:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    xlsx = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.expanduser("~"), "Downloads", "Job Search Tracker-5.xlsx"
    )
    db_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "data", "app.db")

    if not os.path.exists(xlsx):
        sys.exit(f"Spreadsheet not found: {xlsx}")
    if not os.path.exists(db_path):
        sys.exit(f"Database not found: {db_path} (start the app once to create it)")

    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb["Applications"]
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0] not in (None, "")]

    today = dt.datetime.now(dt.timezone.utc)
    now_iso = today.isoformat().replace("+00:00", "Z")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    cur.execute("DELETE FROM stage_events")
    cur.execute("DELETE FROM applications")

    n_apps = 0
    n_events = 0
    reached = {"applied": 0, "screen": 0, "first-round": 0, "rejected": 0, "ghosted": 0}

    for r in rows:
        (company, title, category, applied, priority, status,
         response, screen, interview, rejection, notes) = (list(r) + [None] * 11)[:11]

        if not applied:
            continue  # cannot place on the timeline without an applied date

        app_id = nano()

        # ---- Build the stage-history events from the real dates ----
        events = [("applied", iso_at(applied))]
        last_dt = applied
        if isinstance(screen, dt.datetime):
            events.append(("screen", iso_at(screen)))
            last_dt = max(last_dt, screen)
        if isinstance(interview, dt.datetime):
            events.append(("first-round", iso_at(interview)))
            last_dt = max(last_dt, interview)

        if isinstance(rejection, dt.datetime):
            events.append(("rejected", iso_at(rejection)))
            last_dt = max(last_dt, rejection)
        elif status == "Dormant/no response":
            # Went quiet. Place the "ghosted" transition at the dormancy
            # threshold (30 days after the last known activity), capped at today.
            ghost = max(last_dt + dt.timedelta(days=30), applied + dt.timedelta(days=30))
            if ghost > today.replace(tzinfo=None):
                ghost = today.replace(tzinfo=None)
            events.append(("ghosted", iso_at(ghost)))

        # ---- Structured dimensions ----
        industry = category if (category and category != "Unknown") else None
        role_type = classify_role_type(str(title) if title else "")

        # ---- Compose notes: preserve Priority + first Response (industry and
        # role type are now structured columns, no longer folded into notes) ----
        meta = []
        if priority:
            meta.append(f"Priority: {priority}")
        # Preserve the "first response" date only when it isn't already implied
        # by a screen/interview event, so we don't lose that signal.
        if isinstance(response, dt.datetime) and not isinstance(screen, dt.datetime) \
                and not isinstance(interview, dt.datetime):
            meta.append(f"First response: {date_str(response)}")

        note_parts = []
        if notes:
            note_parts.append(str(notes).strip())
        if meta:
            note_parts.append(" · ".join(meta))
        note_text = "\n".join(note_parts) if note_parts else None

        cur.execute(
            """INSERT INTO applications
               (id, company, role_title, source, date_applied, location, work_mode,
                salary_min, salary_max, salary_period, contact_name, industry,
                role_type, notes, next_action, next_action_date, archived,
                created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (app_id, str(company).strip(), str(title).strip() if title else "(untitled)",
             "Other", date_str(applied), None, "hybrid", None, None, "year", None, industry,
             role_type, note_text, None, None, 0, iso_at(applied), events[-1][1]),
        )
        for stage, when in events:
            cur.execute(
                "INSERT INTO stage_events (id, application_id, stage, note, occurred_at) VALUES (?,?,?,?,?)",
                (nano(), app_id, stage, None, when),
            )
            n_events += 1
            if stage in reached:
                reached[stage] += 1
        n_apps += 1

    conn.commit()
    conn.close()

    print(f"Imported {n_apps} applications, {n_events} stage events.")
    print("Reached-stage counts:", reached)


if __name__ == "__main__":
    main()
