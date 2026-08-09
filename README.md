# Job Application Tracking Dashboard

A single-user web app that owns both the **data-entry** and the **analytics**
surface for a job search — a replacement for the old Sheets + Tableau split, not
an augmentation. Entry is fast and validated; analytics are live (they recompute
from the data on every change, with no refresh cycle).

## Why it's built the way it is

The central modeling decision: **status is an append-only event log, not a
mutable field.** Each application has a `stage_events` stream; the *current
stage* is derived as the latest event. Storing only the current stage would
throw away the funnel — which is the whole point of the analytics layer. Because
every metric is computed from that log on read, the numbers are always live.

## Stack

- **Backend** — Python + FastAPI + stdlib `sqlite3` (a real, durable file
  database in `data/app.db`), served by uvicorn. Interactive API docs at
  `/api/docs`. (The original Node/Express backend it was ported from is kept
  for reference in `legacy/server-node/`.)
- **Frontend** — Vite + React + TypeScript + Tailwind v4, TanStack Query
  (mutations invalidate queries → analytics update live), Recharts.
- **One process in production** — FastAPI serves the built SPA and the API.

SQLite fits the single-user constraint: durable, zero-config, trivially
exportable, and cheap/free to host anywhere that runs Python. If phone entry
becomes a hard requirement later, the same API deploys to any Python host with
a persistent disk (or swap sqlite3 for hosted Postgres — the data-access layer
is the only thing that changes).

## Running it

```bash
pip3 install -r requirements.txt   # backend deps (fastapi, uvicorn, openpyxl, anthropic)
npm install                        # dev-orchestration deps (concurrently)
npm run dev            # API on :4000, Vite on :5173 (proxies /api → :4000)
```

`ANTHROPIC_API_KEY` is only needed if you call the dormant AI endpoints
directly (see *Dormant AI endpoints* below) — no part of the UI uses them.

`npm run seed` loads a sample pipeline on a **fresh** database. It refuses to
overwrite a database that already holds more applications than the sample set
(override with `FORCE_SEED=1` — it is destructive). Timestamped safety copies
of the database live in `data/backups/`.

Open **http://localhost:5173** in development.

For a production-style run (single process serving everything):

```bash
npm run build          # builds the web SPA into web/dist
npm start              # serves SPA + API on http://localhost:4000
```

## Data model

`applications` — one row per application: company, role, source, date applied,
location/remote, salary range, contact, referral source, industry, role type,
job posting URL, notes, next action + date, archived flag, timestamps.
Source is free text with dropdown suggestions, not a closed enum.

`stage_events` — append-only log of `(application_id, stage, note, occurred_at)`.
Current stage, time-in-stage, and funnel drop-off are all derived from this.

Ordered stages: `applied → screen → first-round → later-round → final → offer`,
plus terminal exits `rejected · withdrawn · ghosted`.

`interviews` — one row per interview round (date, format, interviewers,
questions asked, prep/retro notes). Recording an interview-type stage event
**auto-creates a stub** with the date prefilled, so annotating a round never
means re-entering what the log already knows. Deleting a stage event removes
its stub only while the stub is still empty.

`contacts` + `interactions` — networking contacts (the sheet's Outreach tab)
with their own append-only interaction log (outreach / response / connected /
coffee chat / referral ask / follow-up); interactions can link to an
application. Last touch is derived from the log.

`suggestions` — a suggest-only inbox for externally detected stage changes.
An external scanner (e.g. Claude reading Gmail) POSTs
`{applicationId, suggestedStage, evidence, occurredAt}` to `/api/suggestions`;
nothing touches the stage log until the suggestion is **accepted** in the
Follow-ups view. Duplicates of a pending suggestion are absorbed, and stages
already present in the log are refused (409), so re-scans are idempotent.

`settings` — key/value store; currently the weekly application goal.

## Views

- **Pipeline** — filterable list with clickable sortable column headers, a
  days-in-stage column that flags stale applications (>14 days without
  movement), bulk select + archive, and a one-click stage update (writes a
  new event, never an overwrite). A **Table / Board** toggle switches to a
  kanban view: one column per funnel stage plus a combined "Closed" column;
  dragging a card appends a stage event.
- **Detail** — every field inline-editable; collapsible **job description**
  and **resume** archives (paste the posting before it disappears, and the
  exact resume text that went out); **interview rounds** (auto-stubbed from
  stage events) with interviewers, questions asked, and retro notes; full
  stage-history timeline with time-in-stage between events.
- **Follow-ups** — **suggested updates** awaiting review (accept appends the
  stage event, dismiss discards), next actions grouped by urgency
  (overdue / today / soon), plus a **Gone quiet** list of open applications
  with no movement in 21+ days, each with a one-click "Mark ghosted".
- **Contacts** — the networking pipeline: searchable contact cards with
  status/relationship, inline-editable details, and a per-contact interaction
  log that can link entries to applications.
- **Evaluation** — a scoring calculator for a posting you're considering, before
  it becomes an application: seven weighted dimensions (0–10 against published
  anchors), advisory reject-fast flags, and a live composite → verdict. Nothing
  is saved until **Convert to application**, which writes the scored snapshot
  onto a new pipeline entry. Scoring is done by hand — the rubric anchors are
  expandable inline next to each slider. **Autofill** fills the posting half of
  the form from a URL (see *Autofill from a posting* below).
- **Guide** — in-app reference for every view, metric definition, threshold,
  and importer caveat; most controls also carry hover tooltips.
- **Analytics** — live funnel + drop-off, response rate + median days to first
  response, screen rate, stage-to-stage conversion, applications-per-week, a
  **breakdown** that compares conversion across a chosen dimension
  (Industry / Role type), and time-in-stage distribution. A date-range
  picker (All / 30d / 90d / custom) windows everything by date applied, and
  the weekly chart shows an editable **applications-per-week goal** with
  this-week pace and a 4-week average.

Stage transitions can be dated (default: today) and any past event's date edited
inline. A **System / Light / Dark** theme toggle lives in the sidebar.

## Migration from the old tracker

Analytics → **Import / migrate from CSV**: upload the Sheets export, map its
columns to the schema, and import. For historical rows where only the current
stage is known, the log is seeded with a single event at the applied date — so
past applications still appear in the funnel, with the documented caveat that
their intermediate timing is unknown.

For the real "Job Search Tracker" Excel export — which records a *date per
stage* (Response / Initial screen / Interview / Rejection) — use the direct
importer instead, so the full stage-history log is reconstructed from those
dates rather than seeded with a single event:

```bash
python3 scripts/import_sheet.py "/path/to/Job Search Tracker.xlsx"
```

It is **destructive** (clears existing rows, then loads the sheet fresh) — re-run
it whenever you re-export. Category maps to the **Industry** field and the title
is auto-classified into a **Role type**; Priority stays in each record's notes.
Beware: re-running it also resets hand edits (source, job URL, descriptions).
Note: `npm run seed` overwrites this with sample data, so don't run it after
importing real data.

The Outreach tab has its own importer, destructive for **contacts only** —
applications and their hand edits are never touched:

```bash
python3 scripts/import_outreach.py "/path/to/Job Search Tracker.xlsx"
```

Name/Company/Type/Status map to the contact; Date Contacted, Most recent
response, and Connect Date are reconstructed as interaction-log entries;
Next steps + Follow-up by become the contact's next action.

**CSV export** (sidebar → *Export CSV*, or `GET /api/export.csv`) dumps all data
including stage history — an escape hatch against lock-in and a migration safety
net. Retire Sheets/Tableau only after a side-by-side check that the funnel and
rate metrics match.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/applications` | list |
| POST | `/api/applications` | create (seeds first stage event) |
| GET | `/api/applications/:id` | one, with full event history |
| PATCH | `/api/applications/:id` | edit fields |
| POST | `/api/applications/:id/stage` | **append** a stage transition |
| DELETE | `/api/applications/:id/stage/:eventId` | remove a mis-logged event |
| DELETE | `/api/applications/:id` | hard delete (UI defaults to archive) |
| POST | `/api/applications/:id/interviews` | add an interview round |
| PATCH/DELETE | `/api/applications/:id/interviews/:iid` | edit / remove a round |
| GET/POST | `/api/contacts` | list / create contacts |
| GET/PATCH/DELETE | `/api/contacts/:id` | one contact / edit / delete |
| POST | `/api/contacts/:id/interactions` | log an interaction |
| DELETE | `/api/contacts/:id/interactions/:iid` | remove an interaction |
| GET/POST | `/api/suggestions` | pending suggestions / create (for scanners) |
| POST | `/api/suggestions/:id/accept` | accept → appends the stage event |
| POST | `/api/suggestions/:id/dismiss` | dismiss without logging |
| GET/PATCH | `/api/settings` | weekly goal etc. |
| GET | `/api/analytics` | live computed metrics (`?from=&to=` window on date applied) |
| GET | `/api/export.csv` | full CSV export |
| POST | `/api/import` | CSV migration import |
| POST | `/api/postings/fetch` | `{url}` or `{text}` → draft fields + description (no model, no cost) |
| GET | `/api/ai/status` | whether an API key is configured — **not called by the UI** |
| POST | `/api/postings/parse` | `{url}` or `{text}` → draft application fields — **not called by the UI** |
| POST | `/api/evaluations/score` | job description → rubric scores + notes — **not called by the UI** |

### Autofill from a posting (no model, no cost)

`POST /api/postings/fetch` reads a job posting into draft application fields.
It lives in `server/routers/postings.py`, which imports only `server/postings.py`
— pure stdlib. It is *structurally* incapable of a billable call, which is the
point: the AI autofill was removed over per-token cost, and this recovers most
of its value for free. Surfaced in the **New application** modal and on the
**Evaluation** page.

Two tiers:

- **Workday, Greenhouse, Lever, Ashby, and SmartRecruiters URLs** are read
  through those boards' public no-auth JSON APIs. Company, role title, location,
  remote, salary range where published, plus the full description. Not scraping
  — these are documented endpoints, so they don't break when a page is restyled.
  Workday matters most here: banks, insurers, telecoms, pensions, and crown
  corps almost all run it. Unlike the others it has no single API host — each
  tenant is `{tenant}.wd{N}.myworkdayjobs.com` with its own site slug, both
  recovered from the posting URL (the `/en-US/` locale segment is optional).
- **Any other URL** is fetched as HTML and stripped to text: description only.
  Pasting text does the same. With no model there is nothing to read fields out
  of prose, so a field the board doesn't state stays blank rather than guessed.

`roleType` is derived for free from the title by `classify_role_type()`
(`server/domain.py`), the same pure-regex rule the New-application form applies
on blur. **`industry` is the one field nothing fills** — it needs a human.

Only public hosts are fetched; URLs resolving to private or loopback addresses
are refused (`_assert_public_url`). Every handler goes through `_get`/`_get_json`
so that guard can't be bypassed — a third-party scraper library with its own HTTP
stack would have bypassed it entirely, which is part of why one isn't used.

> Adding another ATS is one function: match the host, call the board's API, and
> return `Posting(text, source, hints)`. Append it to `_ATS_HANDLERS`.
> Workable, Recruitee, and Personio are the obvious next candidates, though they
> skew towards European startups — a search for live boards across nine guessed
> slugs found none, so confirm an employer you actually track uses one before
> spending the effort.

### Dormant AI endpoints

The three routes above are implemented and mounted but **deliberately unwired
from the UI**. They were built to cut data entry (read a posting into the form;
score it against the rubric), then disconnected: scoring happens in Claude chat,
which is covered by a subscription, whereas these bill per token against
`ANTHROPIC_API_KEY`. Left in place because they cost nothing when nothing calls
them, and re-attaching a UI is purely additive.

The backing modules are `server/postings.py` (ATS + HTML fetch),
`server/extract.py` (the two Claude calls), `server/evaluation.py` (the rubric as
prompt text), and `server/ai.py` (client wrapper). `/api/postings/parse` reads
Greenhouse, Lever, and Ashby URLs through those boards' public JSON APIs with no
model call at all — the useful half works without a key.

Two notes for anyone re-attaching or extending them:

> The rubric is mirrored in `server/evaluation.py` for prompt construction; the
> TS copy in `web/src/lib/evaluation.ts` remains the source of truth for the
> math. Keep the two in sync, the same way `classifyRoleType` is mirrored across
> the codebase — an import-time assertion in `server/extract.py` fails loudly if
> a dimension or flag is renamed on only one side.
>
> The SDK's structured-output transform **demotes a JSON-Schema `enum` to a plain
> string**, moving the values into the field description, so enums are *not*
> enforced by the API and an off-list answer will fail validation on return.
> Closed sets are therefore modelled as fixed object properties (`RubricScores`,
> `RejectFlags`) or coerced server-side against the allowed list (`industry`,
> `roleType`).

### Email-assisted updates

The suggestions inbox is scanner-agnostic: anything that can POST JSON can
propose a stage change. The intended workflow is asking Claude (with Gmail
access) to *"scan my email for replies from companies in the tracker and POST
suggestions to /api/suggestions"* while the app is running — then reviewing
the results under Follow-ups. Claude never writes to the stage log directly;
Accept/Dismiss stays with you.

## Notes

`data/` is git-ignored, so the database is never committed. Override the DB
location with the `DB_PATH` env var and the port with `PORT`.
