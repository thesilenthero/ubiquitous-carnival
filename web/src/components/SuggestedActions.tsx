import { Link } from "react-router-dom";
import {
  useNextSteps,
  useSetStage,
  useSnoozeNextStep,
  useUpdateApplication,
  useUpdateContact,
} from "../api";
import { StageBadge } from "../components/StageBadge";
import { SkeletonRows } from "../components/Skeleton";
import { URGENT_PLAYS, type NextStep, type NextStepPlay } from "../types";
import { todayIso } from "../lib/format";

// A short tag per play, so a long queue stays scannable without reading every
// title. Deliberately verbs — the tag says what kind of move this is.
const PLAY_LABEL: Record<NextStepPlay, string> = {
  "interview-prep": "Prep",
  "offer-decision": "Decide",
  "thank-you": "Thank",
  revive: "Revive",
  "nudge-contact": "Nudge",
  "ghost-it": "Close",
  "linkedin-outreach": "Outreach",
  "docket-decide": "Docket",
  "no-next-step": "Plan",
  "cold-contact": "Network",
  "weekly-pace": "Pace",
};

function Row({ step }: { step: NextStep }) {
  const update = useUpdateApplication();
  const updateContact = useUpdateContact();
  const setStage = useSetStage();
  const snooze = useSnoozeNextStep();

  // Writing the next action is what makes the play stop firing — it moves the
  // item out of this list and into the dated groups below, which is the whole
  // point of the two living on one page.
  const schedule = () => {
    if (!step.action) return;
    const patch = { nextAction: step.action, nextActionDate: todayIso() };
    if (step.subjectKind === "application") {
      update.mutate({ id: step.subjectId, patch });
    } else if (step.subjectKind === "contact") {
      updateContact.mutate({ id: step.subjectId, patch });
    }
  };

  const urgent = URGENT_PLAYS.includes(step.play);

  return (
    <div className="flex items-start gap-3 p-3">
      <span
        className={`pill mt-0.5 shrink-0 px-1.5 ${
          urgent ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "pill-muted"
        }`}
      >
        {PLAY_LABEL[step.play]}
      </span>

      <div className="min-w-0 flex-1">
        {step.link ? (
          <Link to={step.link} className="font-medium hover:underline">
            {step.title}
          </Link>
        ) : (
          <span className="font-medium">{step.title}</span>
        )}
        <div className="text-xs text-[var(--text-muted)]">{step.detail}</div>
      </div>

      {step.stage ? <StageBadge stage={step.stage} /> : null}

      <div className="flex shrink-0 items-center gap-1.5">
        {step.externalUrl ? (
          <a
            href={step.externalUrl}
            target="_blank"
            rel="noreferrer"
            title="Opens LinkedIn in a new tab"
            className="btn btn-secondary btn-sm"
          >
            LinkedIn ↗
          </a>
        ) : null}

        {step.play === "ghost-it" ? (
          <button
            onClick={() => setStage.mutate({ id: step.subjectId, stage: "ghosted" })}
            title="Record a ghosted event — closes it and keeps your response rate honest"
            className="btn btn-secondary btn-sm"
          >
            Mark ghosted
          </button>
        ) : null}

        {step.play === "docket-decide" ? (
          <button
            onClick={() => setStage.mutate({ id: step.subjectId, stage: "applied" })}
            title="Record an applied event dated today — moves it into the funnel"
            className="btn btn-secondary btn-sm"
          >
            Mark applied
          </button>
        ) : null}

        {step.action ? (
          <button
            onClick={schedule}
            title={`Adds "${step.action}" as a next action due today`}
            className="btn btn-primary btn-sm"
          >
            Add action
          </button>
        ) : null}

        <button
          onClick={() => snooze.mutate(step.id)}
          title="Hide for a week. If it's still true then, it comes back."
          className="btn btn-ghost btn-sm"
        >
          Later
        </button>
      </div>
    </div>
  );
}

// The computed queue: what the pipeline implies you should do, as distinct
// from the actions you've already written down (those are the dated groups).
export function SuggestedActions({ trailing }: { trailing?: React.ReactNode }) {
  const { data: steps, isPending } = useNextSteps();

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--accent)]">
        <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
        Suggested actions
        <span className="font-normal text-[var(--text-muted)]">
          {isPending ? "" : `(${steps?.length ?? 0}) — nothing is recorded until you act`}
        </span>
        {trailing}
      </h2>

      {isPending ? (
        <div className="card">
          <SkeletonRows rows={4} />
        </div>
      ) : (steps ?? []).length === 0 ? (
        <div className="card p-4 text-sm text-[var(--text-muted)]">
          Nothing suggested — no stalled applications, no cold contacts, and
          you're on pace for the week.
        </div>
      ) : (
        <div className="card divide-y divide-[var(--border)]">
          {(steps ?? []).map((s) => (
            <Row key={s.id} step={s} />
          ))}
        </div>
      )}
    </section>
  );
}
