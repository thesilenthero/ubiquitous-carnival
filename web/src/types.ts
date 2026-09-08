// Roles on the docket — wanted, not yet applied to. Deliberately NOT part of
// the funnel: `applied` stays index 0 so "top of funnel" keeps its meaning, and
// the server excludes these rows from every analytics figure. Mirrors
// server/domain.py.
export const PRE_STAGES = ["interested"] as const;

export const FUNNEL_STAGES = [
  "applied",
  "screen",
  "first-round",
  "later-round",
  "final",
  "offer",
] as const;

export const TERMINAL_STAGES = ["rejected", "withdrawn", "ghosted"] as const;
export const ALL_STAGES = [
  ...PRE_STAGES,
  ...FUNNEL_STAGES,
  ...TERMINAL_STAGES,
] as const;
export type Stage = (typeof ALL_STAGES)[number];

export const isPreStage = (s: Stage) =>
  (PRE_STAGES as readonly string[]).includes(s);

// Dropdown suggestions, not a closed enum — the backend accepts any non-empty
// string, and Discover writes the board's ATS name ("Greenhouse"). Casing is
// canonical: the server snaps whatever arrives onto these spellings, so the
// Pipeline column reads evenly. Keep in sync with server/domain.py.
export const SOURCES = [
  "LinkedIn",
  "Indeed",
  "Referral",
  "Recruiter",
  "Direct",
  "Company site",
  "Other",
] as const;
export type Source = (typeof SOURCES)[number];

// Where the applications actually come from, so the new-application form opens
// on the answer that is usually right.
export const DEFAULT_SOURCE: Source = "LinkedIn";

// Where the work happens. Hybrid is the default: it's the common arrangement
// for these roles, and the honest reading of a posting that doesn't say.
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const DEFAULT_WORK_MODE: WorkMode = "hybrid";

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

// Contract roles quote an hourly rate, so a salary figure means nothing on its
// own — $65 and $65,000 are both plausible numbers to type in.
export const SALARY_PERIODS = ["year", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];
export const DEFAULT_SALARY_PERIOD: SalaryPeriod = "year";

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  year: "per year",
  hour: "per hour",
};

export const ROLE_TYPES = [
  "Analyst",
  "Manager",
  "Lead",
  "Specialist",
  "Consultant",
  "Leadership",
  "Data Science",
  "Engineering",
  "Other",
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const INTERVIEW_FORMATS = [
  "phone",
  "video",
  "onsite",
  "panel",
  "technical",
  "take-home",
  "other",
] as const;

export const CONTACT_STATUSES = [
  "Pending",
  "Connected",
  "Followed up",
  "Closed",
] as const;

export const RELATIONSHIPS = [
  "LinkedIn Outreach",
  "1st degree connection",
  "Mutual connection / referred",
  "Recruiter",
  "Former colleague",
  "Other",
] as const;

export const INTERACTION_KINDS = [
  "outreach",
  "response",
  "connected",
  "coffee chat",
  "referral ask",
  "follow-up",
  "other",
] as const;

// What a networking contact does — suggestions for the contact's role field.
export const CONTACT_ROLES = [
  "Recruiter",
  "Hiring Manager",
  "Team member",
  "Analytics / BI peer",
  "Executive / Leadership",
  "HR / Talent",
  "Other",
] as const;

// Common next steps with a contact — suggestions, free values still allowed.
export const CONTACT_NEXT_ACTIONS = [
  "Follow up",
  "Send intro message",
  "Reply to their message",
  "Schedule coffee chat",
  "Ask for referral",
  "Send thank-you",
  "Connect on LinkedIn",
  "Check in",
] as const;

export const INDUSTRIES = [
  "Financial Services",
  "Tech & Telecom",
  "Public Sector & Regulated",
  "Corporate / Enterprise",
  "Professional Services & Other",
] as const;

// Derive a role type from a title. Keep in sync with classifyRoleType in
// src/server/domain.ts and scripts/import_sheet.py.
export function classifyRoleType(title: string): RoleType {
  const t = (title ?? "").toLowerCase();
  if (/(director|head of|head,|chief|vp|vice president)/.test(t)) return "Leadership";
  if (/\blead\b|lead,|lead$/.test(t)) return "Lead";
  if (/manager|management/.test(t)) return "Manager";
  if (/scientist|data science/.test(t)) return "Data Science";
  if (/engineer/.test(t)) return "Engineering";
  if (/analy(st|tics)/.test(t)) return "Analyst";
  if (/consultant/.test(t)) return "Consultant";
  if (/specialist/.test(t)) return "Specialist";
  return "Other";
}

export const STAGE_LABELS: Record<Stage, string> = {
  interested: "Interested",
  applied: "Applied",
  screen: "Screen",
  "first-round": "First round",
  "later-round": "Later round",
  final: "Final",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

export const STAGE_COLORS: Record<Stage, string> = {
  interested: "var(--stage-interested)",
  applied: "var(--stage-applied)",
  screen: "var(--stage-screen)",
  "first-round": "var(--stage-first-round)",
  "later-round": "var(--stage-later-round)",
  final: "var(--stage-final)",
  offer: "var(--stage-offer)",
  rejected: "var(--stage-rejected)",
  withdrawn: "var(--stage-withdrawn)",
  ghosted: "var(--stage-ghosted)",
};

export interface StageEvent {
  id: string;
  applicationId: string;
  stage: Stage;
  note: string | null;
  occurredAt: string;
}

// Imported for use in the Application interface below and re-exported so
// consumers can pull the shape from either module. See lib/evaluation.ts.
import type { Evaluation, VerdictKey } from "./lib/evaluation";
export type { Evaluation, VerdictKey };

import { daysBetween } from "./lib/format";

// --- Posting autofill ----------------------------------------------------

/** Which tier read the posting. An ATS name means the fields came from that
 *  board's public JSON API; "html" and "pasted" yield a description only. */
export type PostingSource =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "html"
  | "pasted";

/** Boards that expose a public JSON API, so autofill returns real fields. */
export const ATS_SOURCES: PostingSource[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
];

// Every field a posting can fill. Null means the board didn't say — never a
// guess. `industry` is always null: nothing infers it without a model.
export interface PostingFields {
  company: string | null;
  roleTitle: string | null;
  location: string | null;
  workMode: WorkMode | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  industry: string | null;
  roleType: string | null;
}

export interface FetchedPosting {
  fields: PostingFields;
  jobDescription: string;
  source: PostingSource;
}

// --- Discovery -----------------------------------------------------------

/** A company ATS board being watched for new postings. */
export interface JobBoard {
  id: string;
  ats: string;
  /** Workday only — each tenant has its own host. Null elsewhere. */
  host: string | null;
  slug: string;
  /** Workday only — the careers site slug. Null elsewhere. */
  site: string | null;
  company: string;
  /** Comma-separated title filter. Empty keeps every posting. */
  keywords: string;
  active: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export type DiscoveredStatus =
  | "new"
  | "saved"
  | "dismissed"
  | "docketed"
  | "applied";

export interface DiscoveredJob {
  id: string;
  boardId: string;
  externalId: string;
  jobUrl: string;
  company: string;
  roleTitle: string;
  location: string | null;
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** As the board words it — Workday says "Posted 2 Days Ago", not a date. */
  postedAt: string | null;
  roleType: string | null;
  firstSeenAt: string;
  status: DiscoveredStatus;
  applicationId: string | null;
}

export interface RefreshResult {
  checked: number;
  added: number;
  errors: string[];
}

export interface Application {
  id: string;
  company: string;
  roleTitle: string;
  source: string;
  dateApplied: string;
  location: string | null;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod;
  /** Who referred you. `contactId` is set when they're in your contacts;
   *  `contactName` is the display name either way. */
  contactName: string | null;
  contactId: string | null;
  industry: string | null;
  roleType: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  resumeText: string | null;
  coverLetterText: string | null;
  // The attached PDFs. The bytes live on the server under data/resumes/ and
  // data/cover_letters/; the client downloads by application id and kind,
  // never by path.
  resumeFilename: string | null;
  resumeSize: number | null;
  resumeUploadedAt: string | null;
  coverLetterFilename: string | null;
  coverLetterSize: number | null;
  coverLetterUploadedAt: string | null;
  /** This application's folder in the off-machine attachment archive. Derived
   *  server-side and claimed on the first attachment; null until then. */
  backupDir: string | null;
  notes: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  archived: boolean;
  // Job-evaluation snapshot, present when the application was created by
  // converting an evaluation. See lib/evaluation.ts.
  evalComposite: number | null;
  evalVerdict: VerdictKey | null;
  evaluation: Evaluation | null;
  createdAt: string;
  updatedAt: string;
  currentStage: Stage;
  stageChangedAt: string;
  events?: StageEvent[];
  interviews?: Interview[];
}

export interface Interview {
  id: string;
  applicationId: string;
  stageEventId: string | null;
  date: string | null;
  format: string | null;
  interviewers: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Interaction {
  id: string;
  contactId: string;
  applicationId: string | null;
  kind: string;
  note: string | null;
  occurredAt: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  roleTitle: string | null;
  relationship: string | null;
  status: string;
  email: string | null;
  linkedinUrl: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
  interactions?: Interaction[];
}

// The activity log — every addition, removal, and edit across the tracker.
// Mirrors server/activity.py. The two timestamps are the point of it:
// `recordedAt` is when you entered the thing, `occurredAt` is the real-world
// date it refers to, and they are routinely different — booking next week's
// first round is something that happened today.
export const ACTIVITY_ACTIONS = ["created", "updated", "deleted"] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface Activity {
  id: string;
  entity: string;
  entityId: string;
  action: ActivityAction;
  applicationId: string | null;
  contactId: string | null;
  summary: string;
  // { field: [before, after] } — present on edits only.
  changes: Record<string, [unknown, unknown]> | null;
  occurredAt: string | null;
  recordedAt: string;
  // "app" is something you did; "import"/"seed"/"backfill" are bulk loads.
  // Backfilled rows carry a GUESSED recordedAt for entities that never stored
  // one — exclude them from anything measuring how fast you hear back.
  source: string;
}

export interface Suggestion {
  id: string;
  applicationId: string;
  suggestedStage: Stage;
  evidence: string | null;
  source: string;
  status: "pending" | "accepted" | "dismissed";
  occurredAt: string | null;
  createdAt: string;
  company: string;
  roleTitle: string;
}

// --- Next steps ----------------------------------------------------------
// Computed server-side on every request (server/next_steps.py) and never
// stored: a play exists exactly as long as the situation that produced it.
export type NextStepPlay =
  | "interview-prep"
  | "offer-decision"
  | "thank-you"
  | "revive"
  | "nudge-contact"
  | "ghost-it"
  | "linkedin-outreach"
  | "docket-decide"
  | "no-next-step"
  | "cold-contact"
  | "weekly-pace";

export interface NextStep {
  id: string;
  play: NextStepPlay;
  priority: number;
  subjectKind: "application" | "contact" | "global";
  subjectId: string;
  title: string;
  detail: string;
  /** In-app destination for the subject, if it has one. */
  link: string | null;
  /** Somewhere off-app the play points at — a LinkedIn profile or search. */
  externalUrl: string | null;
  /** Prefill for the next action this play argues for; null when there is no
   *  single obvious thing to write down. */
  action: string | null;
  stage: Stage | null;
  rank: number;
}

// Grouped for the UI: everything above the line is time-critical.
export const URGENT_PLAYS: NextStepPlay[] = [
  "interview-prep",
  "offer-decision",
  "thank-you",
  "revive",
];

export interface Settings {
  weeklyTarget: number;
  staleDays: number; // Pipeline amber marker: early heads-up
  quietDays: number; // Follow-ups "Gone quiet": time-to-ghost nudge
  screenWindowDays: number; // Analytics: age before silence counts as no screen
}

// State of the Google Sheet mirror (server/sheets_sync.py). Not a setting —
// it's configured by env var on the server; this is read-only status so the UI
// can show the link, when it last synced, and why it stopped if it did.
export interface SheetsStatus {
  configured: boolean;
  sheetUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

// Fallbacks used while settings are loading (mirror the backend defaults).
export const DEFAULT_STALE_DAYS = 14;
export const DEFAULT_QUIET_DAYS = 30;
export const DEFAULT_SCREEN_WINDOW_DAYS = 14;

// Time-since-last-movement, shared by the table, the board and the follow-up
// queue so all three agree on the number. Clamped at 0: an event dated later
// today than the clock — or logged from another timezone — is not "-1 days".
export const daysInStage = (a: Application) =>
  Math.max(0, daysBetween(a.stageChangedAt));

// Neither a closed application nor one still on the docket can go stale: the
// first has nowhere left to move, the second was never claimed to be in play.
export const isStale = (a: Application, staleDays: number) =>
  !(TERMINAL_STAGES as readonly string[]).includes(a.currentStage) &&
  !isPreStage(a.currentStage) &&
  daysInStage(a) > staleDays;

export interface FunnelStep {
  stage: Stage;
  reached: number;
  conversionFromPrev: number | null;
  dropOffFromPrev: number | null;
}

export interface StageDuration {
  stage: Stage;
  count: number;
  medianDays: number;
  p75Days: number;
  maxDays: number;
  avgDays: number;
}

export interface DimensionStat {
  key: string;
  applied: number;
  // Applications old enough (or already answered) to judge — the denominator
  // behind screenRate. `applied` stays the raw volume the bars are drawn from.
  maturedApplied: number;
  reachedScreen: number;
  reachedOffer: number;
  screenRate: number;
  offerRate: number;
}

export interface WeeklyPoint {
  weekStart: string;
  count: number;
}

export interface Analytics {
  totals: {
    applications: number;
    active: number;
    offers: number;
    rejected: number;
    ghosted: number;
    withdrawn: number;
    // Roles on the docket. Outside the funnel and outside every rate below.
    docketed: number;
  };
  screenRate: number;
  // What screenRate was computed over: applications that were answered or have
  // been out at least `windowDays`. `pending` is the ones held back as too
  // recent to count as a miss.
  screenBasis: {
    matured: number;
    pending: number;
    reachedScreen: number;
    windowDays: number;
  };
  responseRate: number;
  medianDaysToFirstResponse: number | null;
  funnel: FunnelStep[];
  dimensions: {
    industry: DimensionStat[];
    roleType: DimensionStat[];
  };
  perWeek: WeeklyPoint[];
  timeInStage: StageDuration[];
  pace: {
    target: number;
    thisWeek: number;
    weekStart: string;
    last4Avg: number;
  };
}
