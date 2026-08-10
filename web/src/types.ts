export const FUNNEL_STAGES = [
  "applied",
  "screen",
  "first-round",
  "later-round",
  "final",
  "offer",
] as const;

export const TERMINAL_STAGES = ["rejected", "withdrawn", "ghosted"] as const;
export const ALL_STAGES = [...FUNNEL_STAGES, ...TERMINAL_STAGES] as const;
export type Stage = (typeof ALL_STAGES)[number];

// Dropdown suggestions, not a closed enum — the backend accepts any non-empty
// string. Keep in sync with src/server/domain.ts.
export const SOURCES = [
  "Indeed",
  "LinkedIn",
  "referral",
  "recruiter",
  "direct",
  "company site",
  "other",
] as const;
export type Source = (typeof SOURCES)[number];

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
  remote: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
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

export type DiscoveredStatus = "new" | "saved" | "dismissed" | "applied";

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
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  contactName: string | null;
  referralSource: string | null;
  industry: string | null;
  roleType: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  resumeText: string | null;
  // The attached resume PDF. The bytes live on the server under data/resumes/;
  // the client downloads by application id, never by path.
  resumeFilename: string | null;
  resumeSize: number | null;
  resumeUploadedAt: string | null;
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
  questions: string | null;
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

export interface Settings {
  weeklyTarget: number;
  staleDays: number; // Pipeline amber marker: early heads-up
  quietDays: number; // Follow-ups "Gone quiet": time-to-ghost nudge
}

// Fallbacks used while settings are loading (mirror the backend defaults).
export const DEFAULT_STALE_DAYS = 14;
export const DEFAULT_QUIET_DAYS = 30;

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
  };
  screenRate: number;
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
