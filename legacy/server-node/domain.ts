// Shared domain vocabulary. The stage list is deliberately ordered: the funnel
// stages describe forward progression, the terminal stages are exits from it.
// Current stage is always DERIVED from the append-only stage_events log, never
// stored as a mutable field on the application.

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

// Stages that imply a conversation happened — recording one auto-creates an
// interview stub so the round can be annotated without re-entering the basics.
export const INTERVIEW_STAGES: readonly Stage[] = [
  "screen",
  "first-round",
  "later-round",
  "final",
];

export const INTERVIEW_FORMATS = [
  "phone",
  "video",
  "onsite",
  "panel",
  "technical",
  "take-home",
  "other",
] as const;

// Contact vocabulary — all suggestions, not closed enums (values seeded from
// the sheet's Outreach tab stay as-is).
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

// Source is a free-text field with dropdown suggestions (like industry) — the
// imported sheet has no application-channel column, so real rows start as
// "other" and get corrected by hand to whatever value fits.
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

// Role type is not tracked in the source sheet — it is derived from the title
// (and editable). Industries are seeded from the real data's Category column but
// remain free-editable, so these are dropdown suggestions, not a closed enum.
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

export const INDUSTRIES = [
  "Financial Services",
  "Tech & Telecom",
  "Public Sector & Regulated",
  "Corporate / Enterprise",
  "Professional Services & Other",
] as const;

// Bucket a job title into a role type. Order matters: seniority/leadership terms
// win over the functional ones (a "Manager, Analytics" is a Manager, not an
// Analyst). Keep in sync with the Python port in scripts/import_sheet.py.
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

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (ALL_STAGES as readonly string[]).includes(v);
}

// An ISO calendar date (YYYY-MM-DD) that actually exists on the calendar.
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !isNaN(new Date(v + "T00:00:00.000Z").getTime());
}

// Any timestamp Date can parse (stage events store full ISO timestamps).
export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && !isNaN(new Date(v).getTime());
}

// Human-facing labels for the ordered stages.
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
