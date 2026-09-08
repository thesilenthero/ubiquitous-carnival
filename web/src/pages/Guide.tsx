import { Link } from "react-router-dom";
import { useSettings } from "../api";
import {
  DEFAULT_QUIET_DAYS,
  DEFAULT_SCREEN_WINDOW_DAYS,
  DEFAULT_STALE_DAYS,
  FUNNEL_STAGES,
  PRE_STAGES,
  STAGE_LABELS,
  TERMINAL_STAGES,
} from "../types";
import { StageBadge } from "../components/StageBadge";

// Static reference for everything in the app. Sections are anchored so the
// table of contents (and future deep links) can jump straight to a topic.

const SECTIONS = [
  ["how-it-works", "How it works"],
  ["stages", "Stages"],
  ["pipeline", "Pipeline"],
  ["detail", "Application detail"],
  ["interviews", "Interviews"],
  ["next-steps", "Next steps & suggestions"],
  ["contacts", "Contacts"],
  ["analytics", "Analytics"],
  ["data", "Data, import & export"],
  ["tools", "Occasional tools"],
] as const;

export default function Guide() {
  // Live values, so the documented thresholds always match the configuration.
  const { data: settings } = useSettings();
  const staleDays = settings?.staleDays ?? DEFAULT_STALE_DAYS;
  const quietDays = settings?.quietDays ?? DEFAULT_QUIET_DAYS;
  const screenWindowDays =
    settings?.screenWindowDays ?? DEFAULT_SCREEN_WINDOW_DAYS;
  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="page-title">Guide</h1>
        <p className="text-sm text-[var(--text-muted)]">
          What everything means and where to find it. Most controls also
          explain themselves on hover.
        </p>
      </header>

      <nav className="card mb-4 flex flex-wrap gap-x-4 gap-y-1 p-4 text-sm">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="text-[var(--accent)] hover:underline"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="how-it-works" title="How it works">
        <p>
          The core idea: an application's status is an <b>append-only event
          log</b>, not a field you overwrite. Every stage change is recorded as
          a new event with a date, the <i>current</i> stage is simply the
          latest event, and every analytics number is recomputed from that log
          on each change — so the funnel, rates, and time-in-stage are always
          live and always reconstructable.
        </p>
        <p>
          Practical consequence: to fix a mistake you edit or delete the wrong
          <i> event</i> (in the Detail view's stage history), never the stage
          itself. Nothing here requires a refresh cycle or a recompute button.
        </p>
      </Section>

      <Section id="stages" title="Stages">
        <p>
          One stage sits before the funnel, for roles you want but haven't
          applied to:
        </p>
        <div className="my-2 flex flex-wrap gap-1.5">
          {PRE_STAGES.map((s) => (
            <StageBadge key={s} stage={s} />
          ))}
        </div>
        <p>
          A docketed role is a real application record — it takes notes, an
          evaluation, and PDF attachments — but it is deliberately outside the
          funnel and excluded from every figure on Analytics, because there is
          no application yet to measure. Mark it applied and it enters the
          funnel with the date you actually sent it. The Pipeline table hides
          the docket behind a toggle; Follow-ups gives it its own section.
        </p>
        <p>Six ordered funnel stages then describe forward progress:</p>
        <div className="my-2 flex flex-wrap items-center gap-1.5">
          {FUNNEL_STAGES.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <StageBadge stage={s} />
              {i < FUNNEL_STAGES.length - 1 && (
                <span className="text-[var(--text-muted)]">→</span>
              )}
            </span>
          ))}
        </div>
        <p>Three terminal stages end an application:</p>
        <div className="my-2 flex flex-wrap gap-1.5">
          {TERMINAL_STAGES.map((s) => (
            <StageBadge key={s} stage={s} />
          ))}
        </div>
        <ul>
          <li>
            <b>{STAGE_LABELS.rejected}</b> — they said no.
          </li>
          <li>
            <b>{STAGE_LABELS.withdrawn}</b> — you pulled out.
          </li>
          <li>
            <b>{STAGE_LABELS.ghosted}</b> — no reply, ever. Recorded as an
            event so the silence is dated too; it does <i>not</i> count as a
            "response" in analytics.
          </li>
        </ul>
      </Section>

      <Section id="pipeline" title="Pipeline">
        <ul>
          <li>
            <b>Table / Board toggle</b> — the same filtered list, two views.
            The board has a column per funnel stage plus one combined
            <i> Closed</i> column; <b>drag a card</b> onto a column to record
            that transition (dropping on Closed asks which terminal stage).
            Your choice of view is remembered.
          </li>
          <li>
            <b>Sorting</b> — click any column header to sort; click again to
            flip direction (▲/▼).
          </li>
          <li>
            <b>In stage</b> — days since the last stage event. Open
            applications quiet for more than {staleDays} days get an amber
            stale marker (the early heads-up before "gone quiet"; the
            threshold is editable in the Pipeline filter bar).
          </li>
          <li>
            <b>Bulk actions</b> — tick rows (or the header checkbox for all
            shown) and an Archive / Unarchive bar appears.
          </li>
          <li>
            <b>Search</b> — matches company, role, notes, location, and
            industry. Filters combine with search.
          </li>
          <li>
            <b>Archive vs delete</b> — archiving hides a row from the default
            view but keeps it in analytics history. Hard delete (in Detail)
            erases the application and its log.
          </li>
          <li>
            <b>↗ icon</b> — opens the saved job posting URL.
          </li>
        </ul>
      </Section>

      <Section id="detail" title="Application detail">
        <ul>
          <li>
            <b>Everything is inline-editable</b> — click a value, type, and it
            saves on blur (Enter saves, Esc cancels for the title fields).
          </li>
          <li>
            <b>Source</b> is free text with suggestions — type anything.
          </li>
          <li>
            <b>Job description</b> — paste the posting text before the listing
            disappears; it's archived with the application and included in CSV
            export.
          </li>
          <li>
            <b>Resume</b> and <b>Cover letter</b> — attach the exact PDFs you
            sent, so you always know precisely what this company saw. Each one's
            text is extracted automatically (paste it yourself if the PDF has no
            text layer), and it's kept even if you detach the file. The resume
            text is also included in CSV export.
          </li>
          <li>
            <b>Stage history</b> — record a transition with an optional
            back-dated date and note. Edit any event's date inline (this can
            reorder history and re-derive the current stage — intended).
            Delete an event with ✕; the last remaining event can't be deleted.
          </li>
        </ul>
      </Section>

      <Section id="interviews" title="Interviews">
        <p>
          Recording a stage event of type {""}
          <b>Screen, First round, Later round, or Final</b> automatically
          creates an interview round with the date prefilled — you only add
          what the log doesn't know: format, interviewers, and notes — the
          questions you were asked, how you prepared, and how it went, all in
          one place.
        </p>
        <p>
          Deleting a stage event also removes its auto-created round, but only
          while the round is still empty — anything you've written survives.
          "+ Add round" creates one manually (e.g. a second conversation
          within the same stage).
        </p>
      </Section>

      <Section id="next-steps" title="Next steps & suggestions">
        <ul>
          <li>
            <b>Suggested updates</b> — stage changes proposed from outside the
            app (e.g. asking Claude to scan Gmail for replies from companies
            in your tracker). Nothing is written to the log until you click
            <b> Accept</b>, which appends the stage event dated when the email
            arrived; <b>Dismiss</b> discards it. The sidebar badge includes
            pending suggestions.
          </li>
          <li>
            <b>Next actions</b> — from applications <i>and</i> contacts,
            grouped together by urgency: overdue, due today, next 3 days,
            later. Contact rows carry a "Contact" pill and open the contact's
            card. Ticking the checkbox marks the action done and clears it.
          </li>
          <li>
            <b>Suggested actions</b> — computed from the pipeline itself, so
            there is nothing to maintain: an interview booked for a future
            date becomes <i>prep</i>, a round that just happened becomes a{" "}
            <i>thank-you</i>, an application silent for {quietDays}+ days
            becomes outreach — asking a contact you already have at that
            company, or finding someone on LinkedIn when you don't. Silence
            for twice that long suggests closing it as ghosted instead, which
            keeps your response rate honest. Each application produces at most
            one suggestion, because it's in one situation at a time.
          </li>
          <li>
            <b>Add action</b> writes the suggestion as a real next action due
            today, which moves it into the groups below and stops it being
            suggested. <b>Later</b> hides one for a week; if the situation
            still holds when that lapses, it comes back. Nothing here writes
            to the stage log except the explicit "Mark ghosted" and "Mark
            applied" buttons.
          </li>
          <li>
            The <b>quiet after</b> threshold in the section header is your
            time-to-ghost rule (the historical import used 30 days for the
            same judgment). It also sets the doubled window for closing
            something out.
          </li>
        </ul>
      </Section>

      <Section id="contacts" title="Contacts">
        <ul>
          <li>
            Your networking pipeline, imported from the sheet's Outreach tab
            and maintained here. Click a card to expand and edit everything
            inline.
          </li>
          <li>
            <b>Status</b> — Pending → Connected → Followed up → Closed (free
            text; these are suggestions).
          </li>
          <li>
            <b>Interaction log</b> — the contact's own event history:
            outreach, response, connected, coffee chat, referral ask,
            follow-up. Entries can be linked to an application, which is how
            referral paths stay traceable. "Last touch" is derived from this
            log.
          </li>
          <li>
            <b>Their role</b> and <b>next action</b> are dropdowns with common
            values (recruiter, hiring manager… / follow up, ask for
            referral…) — anything already stored outside the list still shows.
            Contact next actions also appear in <b>Follow-ups</b> alongside
            application actions.
          </li>
        </ul>
      </Section>

      <Section id="analytics" title="Analytics">
        <ul>
          <li>
            <b>Response rate</b> — share of applications that got <i>any</i>
            reply (screen, interview, even a rejection). Ghosted doesn't
            count — it records the absence of a reply.
          </li>
          <li>
            <b>Days to response</b> — median days from applying to the first
            reply, over applications that got one.
          </li>
          <li>
            <b>Screen rate</b> — applications that reached a screen ÷ the ones
            old enough to judge. An application joins that denominator once it
            has been answered, or once it has been out {screenWindowDays} days
            with no reply; anything newer and still silent is pending, not a
            miss, and is held back until it ages in. Same rule in the
            industry / role-type table. <b>Offer rate</b> — offers ÷ all
            applications.
          </li>
          <li>
            <b>Funnel</b> — how many applications <i>ever reached</i> each
            stage, with stage-to-stage conversion and drop-off counts.
          </li>
          <li>
            <b>Applications per week</b> — with your <b>weekly goal</b> as a
            dashed line. Edit the goal in the header (this week's pace turns
            green at target); the 4-week average sits beside it.
          </li>
          <li>
            <b>Time in stage</b> — median days spent in each stage before
            moving on (ongoing time counts for open applications).
          </li>
          <li>
            <b>Breakdown</b> — conversion compared across Industry or Role
            type slices: which convert, not just which produce volume.
          </li>
          <li>
            <b>Date range</b> — All / 30d / 90d / custom windows every metric
            by date applied.
          </li>
        </ul>
      </Section>

      <Section id="data" title="Data, import & export">
        <ul>
          <li>
            <b>Export data</b> (sidebar) — a zip of four CSVs: applications
            (every field, plus job descriptions), the stage log with its notes,
            interviews, and engagements. Your escape hatch against lock-in;
            nothing is only in the app.
          </li>
          <li>
            <b>Sheet importers</b> — <code>scripts/import_sheet.py</code>{" "}
            reloads applications from the Excel export and is{" "}
            <b>destructive</b>: it resets hand edits like source, job URL, and
            descriptions. <code>scripts/import_outreach.py</code> reloads
            contacts from the Outreach tab and touches <b>contacts only</b> —
            applications are safe.
          </li>
          <li>
            <b>Suggestions API</b> — external scanners POST{" "}
            <code>{`{applicationId, suggestedStage, evidence, occurredAt}`}</code>{" "}
            to <code>/api/suggestions</code>. Pending duplicates are absorbed
            and already-recorded stages are refused, so re-scans are safe.
          </li>
          <li>
            The database is a single SQLite file in <code>data/</code>{" "}
            (git-ignored). <code>npm run seed</code> replaces everything with
            sample data — never run it after importing real data.
          </li>
        </ul>
      </Section>

      <Section id="tools" title="Occasional tools">
        <p>
          These two aren't in the sidebar — they're for a specific moment
          rather than daily work, and the nav stays short because of it. Both
          keep their URLs and all their data.
        </p>
        <ul>
          <li>
            <Link to="/evaluation" className="underline">
              Evaluation
            </Link>{" "}
            — score a role against your criteria before applying, then convert
            the assessment straight into an application.
          </li>
          <li>
            <Link to="/discover" className="underline">
              Discover
            </Link>{" "}
            — the tracked ATS boards and the postings they turn up. This is
            also where boards are added, edited, and removed.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card mb-4 scroll-mt-4 p-5">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text)] [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1.5 [&_code]:rounded [&_code]:bg-[var(--surface-2)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
        {children}
      </div>
    </section>
  );
}
