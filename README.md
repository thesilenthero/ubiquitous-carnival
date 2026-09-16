# Job Application Tracker

A small web app for running a job search: the roles you've applied to, where each
one stands, who you've talked to, and how the whole thing is going. It replaces
the spreadsheet-and-dashboard setup it grew out of — you type applications in,
and the charts keep themselves up to date.

It runs on your own machine, for one person. There's no account and no sign-in.

## Getting started

```bash
pip3 install -r requirements.txt   # Python side
npm install                        # JavaScript side
npm run dev
```

Then open **http://localhost:5173**.

To run it the way you'd use it day to day — one program, one address:

```bash
npm run build
npm start                          # http://localhost:4000
```

`npm run seed` fills a brand-new database with sample data so you can look
around. It won't overwrite a database that already has real applications in it.

## What's in it

**Pipeline** — the main list of applications. Sort it, filter it, update a
status in one click, or archive several at once. A **Board** toggle switches to
a drag-and-drop card view with a column per stage. Anything sitting still for
more than two weeks gets flagged.

**Detail** — one application, with every field editable in place. Paste in the
job description before the posting disappears, attach the resume and cover
letter you actually sent, write up each interview round, and read the full
history of how the application has moved.

**Next steps** — your to-do list, worked out from the pipeline itself: prep for
a booked interview, send a thank-you, chase something that's gone quiet, close
out what's clearly dead. You can turn any suggestion into a real task, or hide
it for a week. Your own dated tasks sit below, grouped by how urgent they are.

**Contacts** — people you've talked to, with a log of every conversation and
which application it was about.

**Analytics** — how the search is going: the funnel and where people drop out,
how often you hear back and how fast, stage-to-stage conversion, applications
per week against a goal you set, and a breakdown by industry or role type. A
date picker narrows all of it. Alongside those sits an **effort score**, which
counts the work you put in rather than the results you got — because two days
preparing for an interview otherwise look exactly like two days off.

**Guide** — the in-app manual: what every number means and how every threshold
is set.

Two more pages aren't in the sidebar; reach them from the Guide.

**Discover** (`/discover`) — new postings pulled automatically from the careers
sites of employers you're watching. Paste a careers URL, add a keyword or two,
and press Refresh. Each posting can be saved, dismissed, or turned into an
application. Keywords matter: one large employer can post thousands of jobs.

**Evaluation** (`/evaluation`) — a scorecard for a role you're considering.
Rate it on seven things, see a score and a verdict, and convert it into an
application if it's worth it. Nothing is saved until you do.

## Your data

Everything is in one file: **`data/app.db`**. The attached PDFs are in there
too, so copying that one file backs up the lot. It's never committed to git, and
timestamped safety copies go to `data/backups/`.

You can also get everything out at any time — **Export data** in the sidebar
gives you six CSV files covering applications, status history, interviews,
contact conversations, the change log, and logged effort.

Three optional copies keep themselves current in the background, so your data
isn't only in one place:

| Copy | Where it goes | What it's for |
| --- | --- | --- |
| CSV files | `CSV_EXPORT_DIR` | Readable from anywhere your cloud folder syncs to — a phone included |
| A Google Sheet | `GOOGLE_SHEET_ID` | A real spreadsheet you can pivot and chart |
| Resumes & cover letters | `ATTACHMENT_BACKUP_DIR` | A folder per application, so you can open an old resume in Finder to write the next one |

All three are one-way copies of the database. Editing them changes nothing here,
and the Sheet's five synced tabs are overwritten every time — build your own
charts in your own tabs and they'll survive. The document folder only ever
gains files: deleting an application in the app leaves its PDFs alone.

If a folder is missing or a sync fails, you get a warning and nothing else
breaks. Leave a setting blank to turn that copy off entirely.

## Settings

Put these in a `.env` file at the top of the project. It holds passwords and
keys, so it stays out of git — keep it that way.

| Setting | What it does |
| --- | --- |
| `GOOGLE_SHEET_ID` | The Google Sheet to mirror to |
| `GOOGLE_SHEETS_CREDENTIALS` | Key file for that Sheet (defaults to `~/.config/job-tracker/google-service-account.json`) |
| `CSV_EXPORT_DIR` | Folder for the synced CSV files |
| `ATTACHMENT_BACKUP_DIR` | Folder for resumes and cover letters (defaults to `~/Documents/Career/Applications`) |
| `DB_PATH` | Where the database file lives |
| `PORT` | Port the server runs on |
| `ANTHROPIC_API_KEY` | Only needed for a few AI features nothing in the app currently uses |

Changes take a restart.

## Connecting a Google Sheet

The app signs in as a robot account, so it can keep the Sheet current without
ever asking you to log in again. Once:

1. At [console.cloud.google.com](https://console.cloud.google.com), make a
   project and turn on the **Google Sheets API**.
2. Under **Credentials**, create a **service account**. It needs no roles.
3. Open it, go to **Keys**, add a **JSON** key, and save the download somewhere
   private — `~/.config/job-tracker/google-service-account.json` is the spot the
   app looks in by default.
4. Make a blank Google Sheet and **share it as an Editor** with the service
   account's email address (it ends in `.iam.gserviceaccount.com`). Skipping
   this is what a "caller does not have permission" error means.
5. Copy the Sheet's id out of its address bar — it's the long piece between
   `/d/` and `/edit` — into `.env`, and restart.

Copy the whole id, all 44 characters. It can contain dashes, so a copy that
stops at one looks fine but gets rejected with `400 Request contains an invalid
argument`.

The Analytics page has a **Google Sheet** card showing whether it's working,
when it last synced, and a **Sync now** button.

## Using it from your phone

Same Wi-Fi only, and your Mac has to be awake with the app running. Run it as
`caffeinate -s npm run lan` to stop the Mac sleeping while it's serving.

```bash
npm run build     # only after code changes
npm run lan
```

It prints two addresses. Use the `.local` one — the numeric IP changes over
time, the name doesn't. On iPhone, *Add to Home Screen* opens it without the
Safari bars around it.

Worth knowing: **there is no login.** Anyone on that Wi-Fi who opens the address
sees your salaries, contacts, and PDFs. Fine at home, not fine on café or office
Wi-Fi.

## Bringing in your old spreadsheet

If you have the "Job Search Tracker" Excel file, import it directly so the full
history of each application is rebuilt rather than flattened:

```bash
python3 scripts/import_sheet.py "/path/to/Job Search Tracker.xlsx"
python3 scripts/import_outreach.py "/path/to/Job Search Tracker.xlsx"   # the Outreach tab
```

Both **wipe and reload** what they cover, so re-running loses any edits you've
made since. The first one replaces applications, the second only contacts.
Don't run `npm run seed` afterwards — it would overwrite your real data with
samples.

For any other spreadsheet, use **Import / migrate from CSV** on the Analytics
page: upload it, match up the columns, import.

Before you retire the old setup, put the two side by side and check the numbers
agree.

## Under the hood

The app is Python (FastAPI) and SQLite on the back, React and TypeScript on the
front. In production one program serves both.

For how it's built and why — the data model, the API, how postings are read from
careers sites, how attachments are stored — see **[docs/design.md](docs/design.md)**.
