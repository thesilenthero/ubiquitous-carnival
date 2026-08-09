// Seeds a realistic sample pipeline so the analytics views are populated on a
// fresh install. Idempotent-ish: it clears existing rows first. Run: npm run seed
import { db } from "./db.js";
import { initSchema } from "./db.js";
import { createApplication, addStageEvent } from "./repo.js";
import { type Stage } from "./domain.js";

initSchema();
db.exec("DELETE FROM stage_events; DELETE FROM applications;");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const dateDaysAgo = (n: number) =>
  new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

interface Seed {
  company: string;
  role: string;
  source: string;
  appliedDaysAgo: number;
  remote?: boolean;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  contact?: string;
  referral?: string;
  nextAction?: string;
  nextActionInDays?: number;
  notes?: string;
  // progression: [stage, daysAgo] pairs after the initial applied event
  path: [Stage, number][];
}

const seeds: Seed[] = [
  {
    company: "Stripe",
    role: "Data Analyst, Payments",
    source: "referral",
    appliedDaysAgo: 45,
    remote: true,
    salaryMin: 120000,
    salaryMax: 150000,
    contact: "Priya N.",
    referral: "Former colleague",
    path: [
      ["screen", 40],
      ["first-round", 33],
      ["later-round", 26],
      ["final", 18],
      ["offer", 12],
    ],
    notes: "Strong process. Offer under negotiation.",
  },
  {
    company: "Notion",
    role: "Analytics Engineer",
    source: "LinkedIn",
    appliedDaysAgo: 38,
    remote: true,
    salaryMin: 130000,
    salaryMax: 160000,
    path: [
      ["screen", 34],
      ["first-round", 28],
      ["rejected", 21],
    ],
    notes: "Rejected after technical — SQL take-home was rough.",
  },
  {
    company: "Airbnb",
    role: "Product Analyst",
    source: "Indeed",
    appliedDaysAgo: 30,
    location: "San Francisco, CA",
    salaryMin: 125000,
    salaryMax: 155000,
    path: [
      ["screen", 25],
      ["first-round", 17],
      ["later-round", 9],
    ],
    nextAction: "Send thank-you note to panel",
    nextActionInDays: -1,
  },
  {
    company: "Datadog",
    role: "BI Analyst",
    source: "recruiter",
    appliedDaysAgo: 28,
    remote: true,
    contact: "Marcus (recruiter)",
    path: [["screen", 22]],
    nextAction: "Prep for first round",
    nextActionInDays: 2,
    notes: "Waiting to hear back on scheduling.",
  },
  {
    company: "Figma",
    role: "Data Scientist, Growth",
    source: "referral",
    appliedDaysAgo: 25,
    remote: true,
    referral: "Bootcamp friend",
    path: [
      ["screen", 20],
      ["first-round", 13],
      ["ghosted", 0],
    ],
    notes: "No response for 2+ weeks after first round.",
  },
  {
    company: "Shopify",
    role: "Senior Data Analyst",
    source: "LinkedIn",
    appliedDaysAgo: 21,
    remote: true,
    salaryMin: 110000,
    salaryMax: 140000,
    path: [["screen", 16]],
    nextAction: "Complete SQL assessment",
    nextActionInDays: 1,
  },
  {
    company: "Coinbase",
    role: "Analytics Lead",
    source: "direct",
    appliedDaysAgo: 18,
    remote: true,
    path: [["rejected", 14]],
    notes: "Auto-reject, likely seniority mismatch.",
  },
  {
    company: "Retool",
    role: "Data Analyst",
    source: "Indeed",
    appliedDaysAgo: 14,
    remote: false,
    location: "New York, NY",
    path: [["screen", 9]],
    nextAction: "Follow up with recruiter",
    nextActionInDays: -3,
  },
  {
    company: "Vanta",
    role: "Business Analyst",
    source: "LinkedIn",
    appliedDaysAgo: 10,
    remote: true,
    path: [],
    nextAction: "No response yet — nudge",
    nextActionInDays: 0,
  },
  {
    company: "Ramp",
    role: "Data Analyst, Finance",
    source: "referral",
    appliedDaysAgo: 7,
    remote: true,
    referral: "Ex-manager",
    path: [["screen", 3]],
    nextAction: "Recruiter call Thursday",
    nextActionInDays: 3,
  },
  {
    company: "Webflow",
    role: "Marketing Analyst",
    source: "Indeed",
    appliedDaysAgo: 5,
    remote: true,
    path: [],
  },
  {
    company: "Linear",
    role: "Product Data Analyst",
    source: "direct",
    appliedDaysAgo: 3,
    remote: true,
    path: [],
    notes: "Dream company — small team.",
  },
  {
    company: "Brex",
    role: "Analytics Engineer",
    source: "recruiter",
    appliedDaysAgo: 2,
    remote: true,
    contact: "Dana (in-house recruiter)",
    path: [],
    nextAction: "Send updated resume",
    nextActionInDays: 1,
  },
];

for (const s of seeds) {
  const app = createApplication({
    company: s.company,
    roleTitle: s.role,
    source: s.source,
    dateApplied: dateDaysAgo(s.appliedDaysAgo),
    remote: s.remote ?? false,
    location: s.location ?? null,
    salaryMin: s.salaryMin ?? null,
    salaryMax: s.salaryMax ?? null,
    contactName: s.contact ?? null,
    referralSource: s.referral ?? null,
    notes: s.notes ?? null,
    nextAction: s.nextAction ?? null,
    nextActionDate:
      s.nextActionInDays !== undefined
        ? dateDaysAgo(-s.nextActionInDays)
        : null,
  });
  for (const [stage, d] of s.path) {
    addStageEvent(app.id, stage, null, daysAgo(d));
  }
}

console.log(`Seeded ${seeds.length} applications.`);
