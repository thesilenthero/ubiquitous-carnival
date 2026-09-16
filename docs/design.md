# Design notes

How the tracker is built and why. For what it does and how to run it, see the
[README](../README.md).

## The central decision

**Status is an append-only event log, not a mutable field.** Each application
has a `stage_events` stream; the *current stage* is derived as the latest event.
Storing only the current stage would throw away the funnel — which is the whole
point of the analytics layer. Because every metric is computed from that log on
read, the numbers are always live.

A second log, `activity`, extends the same idea across every entity — each
addition, removal and edit — and splits the timestamp in two: when you *entered*
it, and the real-world date it *refers to*. `stage_events` only ever had the
second, so a first round booked for next Thursday is a row dated next Thursday
and the week you actually heard back leaves no trace. Both facts are now stored,
and one endpoint answers either question.

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

Settings come from the environment, and a `.env` at the repo root is read into
it at startup (`server/env.py`). The file is read by every entry point —
`npm run dev`, `npm start`, `npm run lan`, and the scripts in `scripts/`,
including one run from cron with no shell profile loaded. A real environment
variable always wins over the file, so `GOOGLE_SHEET_ID=… npm start` still
overrides it for a one-off, and a deployment that injects real environment
variables is unaffected.

`npm run seed` refuses to overwrite a database that already holds more
applications than the sample set (override with `FORCE_SEED=1` — it is
destructive).

## Data model

`applications` — one row per application: company, role, source, date applied,
location, work mode, pay range + period, referrer, industry, role type,
job posting URL, notes, next action + date, archived flag, timestamps.
Source is free text with dropdown suggestions, not a closed enum.

Work mode is `remote` / `hybrid` / `onsite`, defaulting to hybrid — it replaced
a remote boolean that could only say "fully remote or not", collapsing hybrid
and on-site together. Pay carries a period (`year` / `hour`) because contract
roles quote an hourly rate, and hourly figures are never converted to annual:
the hours aren't known, so any such number would be invented.

The referrer is one field, not two. `contact_id` links to a `contacts` row when
the person is one of your contacts, and `contact_name` is the display name
either way, so someone not in the list is still recorded. It replaced a
free-text contact name that duplicated the contacts table and a referral source
that duplicated `source`.

`stage_events` — append-only log of `(application_id, stage, note, occurred_at)`.
Current stage, time-in-stage, and funnel drop-off are all derived from this.

Ordered stages: `applied → screen → first-round → later-round → final → offer`,
plus terminal exits `rejected · withdrawn · ghosted`.

Before the funnel sits one pre-stage, `interested` — **the docket**: roles you
want but haven't applied to. A docketed role is an ordinary application row, so
it carries notes, an evaluation, and PDF attachments, but it is deliberately not
part of the funnel and `server/analytics.py` excludes it from every figure,
including the date range — an un-applied role has no date to measure and must not
move a rate. Its `date_applied` is a placeholder until it graduates: recording an
`applied` event rewrites the date to that event's, and pulls the docket entry
behind it so back-dating still reads correctly. The Pipeline table hides the
docket behind a toggle, the Board gives it the leftmost column, and Next steps
lists it under **On the docket**.

`interviews` — one row per interview round (date, format, interviewers, and a
single notes field: questions asked, prep and retro together). Recording an
interview-type stage event **auto-creates a stub** with the date prefilled, so
annotating a round never means re-entering what the log already knows. Deleting
a stage event removes its stub only while the stub is still empty.

`contacts` + `interactions` — networking contacts (the sheet's Outreach tab)
with their own append-only interaction log (outreach / response / connected /
coffee chat / referral ask / follow-up); interactions can link to an
application. Last touch is derived from the log.

`suggestions` — a suggest-only inbox for externally detected stage changes.
An external scanner (e.g. Claude reading Gmail) POSTs
`{applicationId, suggestedStage, evidence, occurredAt}` to `/api/suggestions`;
nothing touches the stage log until the suggestion is **accepted** in the
Next steps view. Duplicates of a pending suggestion are absorbed, and stages
already present in the log are refused (409), so re-scans are idempotent.

`activity` — the second append-only log, and this one spans every entity:
each addition, removal, and edit, with **two timestamps kept apart**.
`recorded_at` is when you entered it; `occurred_at` is the real-world date the
entry refers to, and is null for the many edits that have no date of their own.

They are routinely different, which is the whole reason the table exists.
`POST /api/applications/:id/stage` accepts an explicit `occurredAt`, so booking
next Thursday's first round writes a stage event dated next Thursday — and
nothing else records that you heard back *today*. With both clocks stored, one
endpoint answers both "how much did the search actually move this week?"
(`?from=&to=`) and "what is on the calendar next week?"
(`?dateField=occurred`), over the very same rows.

Entries are appended by the data layer as a side effect of the write that caused
them (`server/activity.py`, called from `repo.py` / `contacts.py` /
`discovery.py` / `suggestions.py`), never by a route — so there is no way to post
an entry for something that didn't happen. Two deliberate choices: the table
carries **no foreign key** back to applications or contacts, and denormalizes a
`summary`, so the row recording a deletion outlives the row it describes; and a
board refresh logs nothing, because one poll can add hundreds of machine-found
postings and would bury a week of real work. Only acting on a posting is logged.

`source` marks where a write came from — `app` for something you did, against
`import` / `seed` / `backfill` for bulk loads. **`backfill` matters:**
`stage_events` and `interactions` never stored a creation time, so for rows
predating this table the entry time is unrecoverable and the migration sets
`recorded_at = occurred_at` — the only defensible fallback, and exactly the
conflation this feature exists to end. The tag is there so any later
"how fast do I hear back" metric excludes a guess instead of reading it as an
observation.

`effort_entries` — hand-logged work that writes to nothing else: interview
prep, a take-home, an hour of practice. `(kind, occurred_at, note,
application_id)`, one row per session. It exists because everything else the
tracker records is a side effect of something happening *to* an application,
and the two days before a screen touch nothing at all — so they score zero on
every outcome metric here, which is the opposite of the truth. The link to an
application is `ON DELETE SET NULL` rather than cascading, alone among the child
tables: the hour was spent whether or not you later delete the role.

`settings` — key/value store: the weekly application goal, the weekly effort
goal, and the stale / quiet / screen-window thresholds.

## The effort score

Every other number on the Analytics page measures an *outcome*: applications
sent, screen rate, conversion, days to first response. None of them measure the
work. Spend two days preparing for a screen and every chart reads exactly like
two days off — which is backwards, and it is the one thing the page was
consistently wrong about.

Effort prices what a week cost, in units where **one application sent = 1**:

| | |
| --- | --- |
| Applied | 1 |
| Screen | 2 |
| First round | 3 |
| Later / final round | 4 |
| Contact interaction | 1 |
| Logged prep session | 1–4 by kind (`server/domain.py`) |

The zeros are the load-bearing part. `offer`, `rejected`, `withdrawn` and
`ghosted` are worth nothing: a rejection arriving is not something you did, and
scoring it would credit you for the week a company happened to reply.
`interested` is 0 for the same reason it sits outside the funnel. Attachment
uploads are unscored too — they are the largest single bucket of activity in
this database, and counting them would turn the metric into a PDF counter when
the tailoring is already priced into `applied`.

Two halves make the number. The derived half is read straight off
`stage_events` and `interactions` — not off the activity log, which has no
stage column, carries orphaned rows for events since deleted, and whose
`recorded_at` is a backfilled guess for most of its history. The logged half is
`effort_entries`, and it is why the feature needs a table at all: prep writes
to nothing, so no weighting of existing rows could ever see it. One entry is
one session, with no hours field — a duration is a decision every time you log,
and logging has to stay cheap enough to do on the day you're busy preparing.

Weeks are bucketed by **when the work happened** (`occurred_at`), so booking
Thursday's round on Monday credits Thursday, the day you sit through it. That
makes the date-range picker mean something different for this one card — it
bounds the weeks shown rather than filtering applications by date applied — and
the card says so out loud, because the two cannot be read as the same filter.

## Next steps

**Suggested actions** is computed from the pipeline on every request
(`server/next_steps.py`) and stored nowhere: prep for a booked interview, a
thank-you after one that just happened, reviving a stalled conversation,
outreach on an application gone quiet — asking a contact you already have at
that company, or finding someone on LinkedIn when you don't — closing out
what has been silent twice as long, and deciding docketed roles. Each
application yields at most one suggestion, because it is in one situation at
a time. **Add action** writes the suggestion as a real next action, which is
exactly what stops it being suggested; **Later** hides one for a week and it
returns if still true.

## The mirrors

### The attachment archive

Every attached resume and cover letter is also copied to
`ATTACHMENT_BACKUP_DIR` (default `~/Documents/Career/Applications`, which is
iCloud-synced), one folder per application:

```
2026-08-15 Scotiabank — Manager, Analytics/
    resume.pdf
    cover-letter.pdf
    resume (2026-08-10).pdf     ← displaced by a later upload
```

One folder per application, rather than one per kind, so a role's resume and
cover letter sit together under a name you can recognize.

Now that the database holds the documents this is an **export**, not a second
store — but it earns its keep: a new resume is usually made by opening an old
one and editing it, and that wants a folder you can browse in Finder rather than
a BLOB you have to query for.

The archive is **append-only**. Detaching a document or deleting an application
removes it from the database and leaves the archive alone — a backup that
vanishes with the original doesn't protect against the mistake it exists for.
Replacing a document moves the old copy aside under a dated name.

Mirroring is best-effort: an unreachable archive logs a warning and never fails
an upload. To backfill or repair:

```bash
python3 scripts/backup_attachments.py --dry-run   # report only
python3 scripts/backup_attachments.py             # copy what's missing
```

It is idempotent (identical bytes are skipped) and exits non-zero on failure, so
it is safe to schedule.

Archiving turns itself off where it makes no sense: `ATTACHMENT_BACKUP_DIR=""`
disables it explicitly, and so does a *parent* directory that doesn't exist —
which is what a cloud host looks like, since there is no `~/Documents/Career`
there. Nothing is then written outside the database.

### The synced CSVs

The Sheet this replaced was also the copy of the data you could read from
anywhere. To keep that, the server writes the full export — the same content
`GET /api/export.zip` holds, but as loose CSVs rather than an archive, because a
zip is not something you can open on a phone — to `CSV_EXPORT_DIR` after every
change, under fixed names:

```
~/Documents/Career/Job Tracker Data/
    job-applications.csv
    job-stage-events.csv
    job-interviews.csv
    job-interactions.csv
    job-activity.csv
    job-effort.csv
```

Always the same filenames, overwritten in place: no timestamp in the name, so
whatever syncs the folder keeps the version history and the links never move.

Writes are debounced by a couple of seconds, so a drag across the board or a
CSV import produces one write rather than a dozen, and a file whose bytes
haven't changed isn't rewritten at all — a file's timestamp only moves when
its data did. Like the attachment archive it is best-effort: an unreachable
folder logs one warning and never fails an edit, and the folder is never
created, so a missing or unmounted target doesn't leave a stray directory
behind.

For changes the server doesn't serve — a direct `sqlite3` edit, an import
script — refresh it by hand:

```bash
python3 scripts/export_csv.py --dry-run   # report only, per file
python3 scripts/export_csv.py             # refresh the mirror
```

### The Google Sheet

The CSVs restore the *content* of the old Sheet but not the thing it was: a
spreadsheet you can pivot, chart and filter. Point the server at a Google Sheet
and it keeps one current too, alongside the CSVs — same data, same trigger, one
tab per export:

| Tab | Holds |
| --- | --- |
| `Applications` | every application, one row each |
| `Stage events` | the stage log behind the pipeline |
| `Interviews` | interviews, with format, interviewers and notes |
| `Interactions` | contact touchpoints, networking included |
| `Activity` | the change log |

Values go up as if typed, so salaries arrive as numbers and dates as dates —
the tabs are pivotable, not 23 columns of text. Text that would otherwise be
read as a formula (a note starting with `=`, a `+1 555…` phone number) is
escaped to stay literal.

**The synced tabs are overwritten on every push.** This is a mirror of the
database, not a place to edit. Tabs *you* add are never touched, so build pivots
and charts in their own tab and they'll keep working as the data underneath
refreshes.

The server writes as a **service account** — a robot Google account with its own
key file. No browser sign-in and no token to re-authorize later, which is what
lets a background thread keep the Sheet current. The Sheet stays in your Drive;
the service account is a guest you invite. Setup steps are in the
[README](../README.md#connecting-a-google-sheet).

The id is read once at import, so a change to `.env` takes a server restart. The
five tabs are created on the first push, with the header row frozen and bold; an
existing `Sheet1` is left alone. Needs `google-api-python-client` and
`google-auth` from `requirements.txt` — both are imported lazily, so the app
runs fine without them until you turn this on.

Failures never fail an edit: one warning is logged and the reason shows on the
**Google Sheet** card on the Analytics page, which also has a **Sync now**
button. As with the CSVs, pushes are debounced and identical data is never
re-uploaded.

```bash
python3 scripts/export_sheets.py --dry-run   # report only, per tab
python3 scripts/export_sheets.py             # push if anything changed
```

## Import and export

Analytics → **Import / migrate from CSV**: upload the Sheets export, map its
columns to the schema, and import. For historical rows where only the current
stage is known, the log is seeded with a single event at the applied date — so
past applications still appear in the funnel, with the documented caveat that
their intermediate timing is unknown.

For the real "Job Search Tracker" Excel export — which records a *date per
stage* (Response / Initial screen / Interview / Rejection) — `scripts/import_sheet.py`
reconstructs the full stage-history log from those dates rather than seeding a
single event. It is destructive (clears existing rows, then loads the sheet
fresh). Category maps to the **Industry** field and the title is auto-classified
into a **Role type**; Priority stays in each record's notes.
`scripts/import_outreach.py` does the Outreach tab, destructive for contacts
only: Name/Company/Type/Status map to the contact; Date Contacted, Most recent
response, and Connect Date are reconstructed as interaction-log entries; Next
steps + Follow-up by become the contact's next action.

**Data export** (sidebar → *Export data*, or `GET /api/export.zip`) dumps all
data as six CSVs — `applications.csv` (every field, plus the stage history
flattened into one cell), `stage-events.csv` (the same log unflattened, with the
notes the flattened cell drops), `interviews.csv`, `interactions.csv` (every
engagement with a contact, and the application it was about),
`activity.csv` (the change log), and `effort.csv` (hand-logged prep and
practice, with each entry's weight). An escape hatch against lock-in and a
migration safety net. `GET /api/export.csv` still returns the applications
sheet on its own.

## CORS

Off by default, which is why the section is this short. The SPA and API share an
origin (one process serves `web/dist`), and in development Vite proxies `/api`
server-side, so the browser never makes a cross-origin request to this app.

The previous `allow_origins=["*"]` was invisible on loopback and became a real
hole the moment the server answered on the LAN: it told every website on the
internet it was welcome to read this unauthenticated API. Set
`ALLOWED_ORIGINS=http://a.example,http://b.example` to opt a specific front end
back in.

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
| GET/PATCH | `/api/settings` | weekly application goal, weekly effort goal, thresholds |
| GET | `/api/next-steps` | the computed play queue — derived, never stored |
| POST | `/api/next-steps/snooze` | `{id, days?}` → hide one play for a week |
| GET | `/api/analytics` | live computed metrics (`?from=&to=` window on date applied) |
| GET | `/api/activity` | the activity log — read-only; see below |
| GET/POST | `/api/effort` | logged effort sessions / log one |
| DELETE | `/api/effort/:id` | remove a logged session |
| GET | `/api/export.zip` | full export — applications, stage events, interviews, engagements, activity, effort |
| GET | `/api/export.csv` | the applications sheet on its own |
| GET | `/api/applications/:id/export.md` | one application as Markdown context for an LLM (`?download=1` for a file) — the Detail page's *Copy for Claude* |
| GET | `/api/sheets/status` | Google Sheet mirror: configured? last synced? last error? |
| POST | `/api/sheets/sync` | push to the Google Sheet now |
| POST | `/api/import` | CSV migration import |
| POST | `/api/postings/fetch` | `{url}` or `{text}` → draft fields + description (no model, no cost) |
| POST | `/api/applications/:id/attachments/:kind` | attach a PDF (multipart), replacing any existing one of that kind |
| GET | `/api/applications/:id/attachments/:kind` | download the attached PDF |
| DELETE | `/api/applications/:id/attachments/:kind` | detach the PDF (the archived text is kept) |
| GET/POST | `/api/boards` | watched ATS boards / add one from a careers URL |
| DELETE | `/api/boards/:id` | stop watching (cascades to its discovered jobs) |
| POST | `/api/boards/refresh` | poll every active board → `{checked, added, errors}` |
| GET | `/api/discovered` | the inbox (`?status=new\|saved\|dismissed\|applied`) |
| POST | `/api/discovered/:id/:action` | `save` · `dismiss` · `apply` |
| GET | `/api/ai/status` | whether an API key is configured — **not called by the UI** |
| POST | `/api/postings/parse` | `{url}` or `{text}` → draft application fields — **not called by the UI** |
| POST | `/api/evaluations/score` | job description → rubric scores + notes — **not called by the UI** |

### The activity log

```
GET /api/activity?from=&to=&dateField=recorded|occurred
                 &entity=&action=&applicationId=&contactId=&source=&limit=200
```

Newest first, capped at 1000. `dateField` picks which clock the range filters
on and defaults to `recorded`; `occurred` also drops entries that have no
real-world date, since those can't answer a calendar question. A bare `to=`
date is inclusive of the whole day, so a Monday–Sunday range doesn't silently
lose Sunday. `action` is `created` · `updated` · `deleted`; on `updated` the
`changes` field holds `{field: [before, after]}` for the fields that actually
moved — an edit that changes nothing writes no row at all.

The two questions it exists to separate:

```
# what did I hear this week
GET /api/activity?from=2026-08-24&to=2026-08-30

# what is on the calendar next week
GET /api/activity?from=2026-08-31&to=2026-09-06&dateField=occurred
```

There is no write route. Nothing is exposed for creating an entry by hand.

## Autofill from a posting (no model, no cost)

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

## PDF attachments

Each application holds one **resume** and one **cover letter** PDF, attached and
downloaded from its Detail page or picked when the application is created. The
two kinds behave identically and share one code path, addressed by the `:kind`
segment of the URL (`resume` or `cover-letter`).

**The bytes live in the database**, in `attachment_blobs`, keyed by
`(application_id, kind)`. An earlier version stored them on disk under
`data/resumes/` and `data/cover_letters/` and argued that BLOBs would push
`app.db` past a gigabyte within a year. Once there was a real corpus to measure,
that turned out to be wrong by roughly 3x — 191 attachments came to 12.3MB,
averaging 63KB with the largest at 141KB, and `app.db` holding all of it is
14MB. What the on-disk store actually cost was portability, which is why it is
gone: **a deployment needs the database and nothing else on its filesystem**, so
the app can move to a hosted database without losing the documents. `BLOB` ports
directly to Postgres `BYTEA`.

They get their own table rather than BLOB columns on `applications` because the
list view reads `SELECT * FROM applications` — blob columns there would drag
every megabyte of PDF through every Pipeline and Board render. Nothing but the
download route touches `attachment_blobs`.

The metadata stays on the application row: `*_filename` (the name the file was
uploaded under, used for `Content-Disposition`), `*_size`, `*_uploaded_at`, and
the extracted `*_text`. The stored SHA-256 doubles as the download `ETag`.

`server/attachment_files.py` owns the `KINDS` table — the only place the per-kind
column names are written — and a `kind` from a request is resolved through it
before it is used for anything, so no request string ever reaches the SQL built
in `repo.py`. It also owns **every path decision** for the archive, which is the
one place attachments still touch a filesystem. Uploads are capped at 10MB and
must be PDFs.

Migrating an older database is `scripts/migrate_attachments_to_db.py`: it loads
each file, verifies the stored blob against it by SHA-256, and leaves the disk
copies alone until a later `--prune` run removes them.

On upload the text layer is extracted into that kind's text column
(`resume_text` / `cover_letter_text`). A PDF with no text layer (a scanned or
image-only document) still uploads and downloads fine — the text is simply left
alone, and the UI says so. Detaching a PDF keeps that text; deleting the
application takes both documents with it, by `ON DELETE CASCADE`. Only
`resume_text` reaches the export's `applications.csv`, which is unchanged.

The original `/api/applications/:id/resume` paths still work as aliases.

## Board discovery

The **Discover** view polls the ATS boards of employers you track. It uses the
same public no-auth APIs as the autofill above, so a refresh costs nothing and
involves no model.

**Keywords are not optional in practice.** Bosch publishes ~4,700 openings; a
single unfiltered employer buries everything else. How a board is narrowed
depends on what its ATS supports, and that decision lives in
`postings.list_board`:

- **Workday and SmartRecruiters** run a real search over the whole posting —
  the same engine their careers sites use. The board is queried **once per
  keyword** and the results unioned, then stored as-is. They are deliberately
  *not* re-filtered on title: a CIBC search for `analytics` returns 41 roles of
  which only 6 carry the word in the title, and "Senior Analyst, Data &
  Reporting" is a real hit. Counts match what the employer's own site shows.
- **Greenhouse, Lever, and Ashby** have no search parameter, so the whole board
  is fetched and matched on **title only**. That is all their list endpoints
  expose, and it is genuinely narrower — a role whose title omits your keyword
  will be missed there.

`MAX_PER_BOARD` caps what one board can contribute regardless of strategy.

`discovered_jobs` is the app's **pre-application state**, and has to be its own
table: `applications.date_applied` is `NOT NULL` and `applied` is the floor of
the funnel, so an un-applied job cannot live in `applications` without
corrupting every rate metric. Nothing in Discover touches analytics until you
press Apply.

Two design notes:

> `discovered_jobs(board_id, external_id)` is the **only `UNIQUE` constraint in
> the schema**, and a deliberate exception to the Python-side dedupe used by
> `create_suggestion`. Polling is precisely the case where idempotency should be
> structural rather than dependent on a query being right — inserts use
> `ON CONFLICT DO NOTHING`, so re-refreshing is a guaranteed no-op.
>
> Descriptions are fetched **on Apply, not on poll**. Workday's list endpoint
> carries no description, and pulling thousands of them per refresh would be
> absurd. A failure there degrades to an application without a description
> rather than blocking the apply. Apply is also idempotent — a double click
> returns the existing application instead of creating a second one.

Per-board failures are recorded in `last_error` and reported in the refresh
summary, but never abort the batch: one dead slug can't stop the rest ingesting.

Two Workday quirks worth knowing, both of which silently truncated results
before they were found:

> It rejects `limit > 20` with a bare HTTP 400 and no message, so paging is
> configured per-ATS in `PAGING`.
>
> It reports `total` on the **first page only** — every later page returns
> `total: 0`. A loop that re-reads `total` each page therefore stops after two
> pages and caps every board at 40 postings. `_list_workday` captures it once.

## Dormant AI endpoints

Three routes are implemented and mounted but **deliberately unwired from the
UI**: `/api/ai/status`, `/api/postings/parse`, and `/api/evaluations/score`.
They were built to cut data entry (read a posting into the form; score it
against the rubric), then disconnected: scoring happens in Claude chat, which is
covered by a subscription, whereas these bill per token against
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

## Email-assisted updates

The suggestions inbox is scanner-agnostic: anything that can POST JSON can
propose a stage change. The intended workflow is asking Claude (with Gmail
access) to *"scan my email for replies from companies in the tracker and POST
suggestions to /api/suggestions"* while the app is running — then reviewing
the results under Next steps. Claude never writes to the stage log directly;
Accept/Dismiss stays with you.

## Notes

`data/` is git-ignored, so the database is never committed. The Google Sheets
credentials file is a key — keep it outside the repo; `.gitignore` covers the
obvious names, but the default lives under `~/.config` for a reason.
