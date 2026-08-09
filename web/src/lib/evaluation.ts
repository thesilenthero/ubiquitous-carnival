// Job-role evaluation model — the in-app version of Derrick's `job-evaluation`
// skill. Single source of truth for the seven weighted dimensions, the composite
// math, the verdict thresholds, and the reject-fast flags. Reused by the
// Evaluation page (input) and the read-only panel on the application detail page.
//
// AI seam: `POST /api/evaluations/score` (server/extract.py) scores a job
// description against this same rubric and returns this `Evaluation` shape minus
// composite/verdict. It is deliberately NOT wired to the UI — scoring is done in
// Claude chat instead, so the API-key cost stays off this app. Keep
// DIMENSIONS/REJECT_FLAGS as the contract so that path can be re-attached with no
// change to the page or the persisted data.

export type DimensionKey =
  | "screening"
  | "roleType"
  | "wlb"
  | "technical"
  | "seniority"
  | "domain"
  | "alignment";

export interface Anchor {
  range: string; // e.g. "9–10"
  text: string;
}

export interface Dimension {
  key: DimensionKey;
  label: string;
  weightPct: number; // contribution to the 100-point composite
  coef: number; // weightPct / 10 — the multiplier on the 0–10 score
  blurb: string; // one line on what the dimension measures
  anchors: Anchor[]; // the scoring rubric, shown inline as guidance
}

// Weights sum to 100%. composite = Σ(score₀‑₁₀ × coef); coef = weightPct / 10,
// so a perfect 10 across all dimensions yields 100.
export const DIMENSIONS: Dimension[] = [
  {
    key: "screening",
    label: "Screening Probability",
    weightPct: 20,
    coef: 2,
    blurb: "How likely you clear a resume screen and recruiter pre-screen.",
    anchors: [
      { range: "9–10", text: "Clear match on title, YOE, tools, domain. No obvious gaps." },
      { range: "7–8", text: "Strong match with one minor gap (tool familiarity, sector)." },
      { range: "5–6", text: "Reasonable match but a meaningful gap in credentials, domain, or title level." },
      { range: "3–4", text: "Notable mismatch in seniority, technical requirements, or sector specificity." },
      { range: "0–2", text: "Likely screened immediately. Graduate credentials required or clearly mis-levelled." },
    ],
  },
  {
    key: "roleType",
    label: "Role Type Fit",
    weightPct: 20,
    coef: 2,
    blurb: "Decision-support/analytical mandate vs. client-relationship ownership (the engagement model).",
    anchors: [
      { range: "9–10", text: "Core mandate is analytical. Success = insight quality and decision impact. No client relationship ownership." },
      { range: "7–8", text: "Primarily analytical. Some external visibility, but you don't own the relationship or get measured on engagement." },
      { range: "5–6", text: "Mixed. Analytical work with meaningful external relationship exposure or client-shaped outputs." },
      { range: "3–4", text: "Client relationship ownership is a core expectation; success partly defined by satisfaction/engagement." },
      { range: "0–2", text: "Fundamentally client-service. Recurring calls, engagement metrics, or relationship ownership are primary duties." },
    ],
  },
  {
    key: "wlb",
    label: "Work-Life Balance Risk",
    weightPct: 20,
    coef: 2,
    blurb: "Does the structure imply overwork or always-on expectations?",
    anchors: [
      { range: "9–10", text: "Planning cycles, governance, or reporting cadences drive urgency. No client/revenue pressure." },
      { range: "7–8", text: "Normal corporate rhythms. Deadline pressure is cyclical and predictable." },
      { range: "5–6", text: "Ambiguous. Fast-paced framing or delivery exposure without explicit overwork signals." },
      { range: "3–4", text: "\"Fast-paced\", \"wears many hats\", or \"thrives under pressure\" language. Client/revenue urgency implied." },
      { range: "0–2", text: "Explicit always-on signals: agency model, client-managed timelines, high-growth startup, relentless delivery." },
    ],
  },
  {
    key: "technical",
    label: "Technical Match",
    weightPct: 15,
    coef: 1.5,
    blurb: "Is applied analytics sufficient, or does it require advanced methods?",
    anchors: [
      { range: "9–10", text: "SQL, BI tools, Python at Pandas level, structured reporting. Direct match." },
      { range: "7–8", text: "Core stack match with one modest gap (e.g. Power BI, Looker)." },
      { range: "5–6", text: "Applied analytics sufficient but role implies statistical modeling depth or ML familiarity." },
      { range: "3–4", text: "Role implies R, advanced regression, causal inference, or graduate-level methods." },
      { range: "0–2", text: "Data scientist, ML engineer, or quantitative analyst role. Hard mismatch." },
    ],
  },
  {
    key: "seniority",
    label: "Seniority Match",
    weightPct: 10,
    coef: 1,
    blurb: "Does the level align — by title, YOE, and scope?",
    anchors: [
      { range: "9–10", text: "Direct match. Senior Analyst or Manager, 5–10 YOE, IC with leadership exposure." },
      { range: "7–8", text: "One level off in title but scope and YOE align." },
      { range: "5–6", text: "Overqualified (rejection risk) or modestly underqualified (gap in management or scope)." },
      { range: "3–4", text: "Clearly too junior or too senior." },
      { range: "0–2", text: "Not in the same tier." },
    ],
  },
  {
    key: "domain",
    label: "Domain Match",
    weightPct: 10,
    coef: 1,
    blurb: "Does the sector fit your experience and target positioning?",
    anchors: [
      { range: "8–10", text: "Preferred: Big Five banks, insurers, telecoms, crown corps, utilities, pensions, large enterprise retail, healthcare admin, public sector." },
      { range: "6–8", text: "Acceptable: mid-tier financial services, enterprise CPG, mature tech with stable internal analytics." },
      { range: "4–6", text: "Marginal: high-growth tech, SaaS, retail media, ad-tech adjacent. Note the sector risk explicitly." },
      { range: "0–3", text: "Hard exclusion: agencies, quota-driven sales orgs, advertiser-facing platform analytics." },
    ],
  },
  {
    key: "alignment",
    label: "Long-term Strategic Alignment",
    weightPct: 5,
    coef: 0.5,
    blurb: "Does this build or undermine your trajectory toward stable decision-support work?",
    anchors: [
      { range: "9–10", text: "Directly builds decision-support credibility, institutional brand, governance exposure, or seniority." },
      { range: "7–8", text: "Neutral to positive. Maintains trajectory even if not ideal." },
      { range: "5–6", text: "Ambiguous. Useful experience but could muddy the narrative." },
      { range: "3–4", text: "Likely pulls the narrative back toward execution, sales, or delivery." },
      { range: "0–2", text: "Actively undermines positioning. Would require re-explaining in future interviews." },
    ],
  },
];

export type FlagKey =
  | "engagementMismatch"
  | "overtime"
  | "credentialGate"
  | "peopleManagement";

export interface RejectFlag {
  key: FlagKey;
  label: string;
  blurb: string;
}

// Advisory "reject-fast" checks from the skill. They surface a caution but do
// NOT change the numeric composite — matching how the skill treats them in prose.
export const REJECT_FLAGS: RejectFlag[] = [
  {
    key: "engagementMismatch",
    label: "Engagement-model mismatch",
    blurb: "Owns recurring client relationships AND is measured on engagement activity.",
  },
  {
    key: "overtime",
    label: "Institutional overtime implied",
    blurb: "\"Thrives under pressure\", \"wears many hats\", \"fast-paced\", \"always on\", \"high-growth\".",
  },
  {
    key: "credentialGate",
    label: "Hard credential gate",
    blurb: "Mandatory domain/credential/technical requirement likely to act as an ATS filter.",
  },
  {
    key: "peopleManagement",
    label: "People management is a core duty",
    blurb: "Full performance-management accountability over 2+ direct reports as a primary duty.",
  },
];

export type VerdictKey = "apply" | "apply-eyes-open" | "marginal" | "skip";

export interface Verdict {
  key: VerdictKey;
  label: string;
  blurb: string;
}

export const VERDICTS: Record<VerdictKey, Verdict> = {
  apply: { key: "apply", label: "Apply", blurb: "Strong overall fit." },
  "apply-eyes-open": {
    key: "apply-eyes-open",
    label: "Apply with eyes open",
    blurb: "Meaningful fit with noted risks or gaps.",
  },
  marginal: {
    key: "marginal",
    label: "Marginal",
    blurb: "Apply only if the pipeline is thin or the gap is closeable with a strong cover letter.",
  },
  skip: {
    key: "skip",
    label: "Skip",
    blurb: "Skip unless there is a specific strategic reason to override the score.",
  },
};

// Verdict colors reuse the app's stage token scale for a green→amber→red read.
export const VERDICT_COLORS: Record<VerdictKey, string> = {
  apply: "var(--stage-offer)", // green
  "apply-eyes-open": "var(--stage-screen)", // blue
  marginal: "var(--stage-ghosted)", // amber
  skip: "var(--stage-rejected)", // red
};

export type Scores = Record<DimensionKey, number>;
export type Notes = Partial<Record<DimensionKey, string>>;
export type Flags = Record<FlagKey, boolean>;

export interface Evaluation {
  scores: Scores;
  notes: Notes;
  flags: Flags;
  conclusion: string;
  composite: number;
  verdict: VerdictKey;
}

export function emptyScores(): Scores {
  return DIMENSIONS.reduce((acc, d) => {
    acc[d.key] = 0;
    return acc;
  }, {} as Scores);
}

export function emptyFlags(): Flags {
  return REJECT_FLAGS.reduce((acc, f) => {
    acc[f.key] = false;
    return acc;
  }, {} as Flags);
}

function clampScore(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(10, Math.max(0, v));
}

// composite = Σ(score × coef). Scores are integers and coefs are multiples of
// 0.5, so the result is always a clean multiple of 0.5 in [0, 100].
export function computeComposite(scores: Scores): number {
  const total = DIMENSIONS.reduce(
    (sum, d) => sum + clampScore(scores[d.key] ?? 0) * d.coef,
    0,
  );
  return Math.round(total * 10) / 10;
}

export function verdictFor(composite: number): Verdict {
  if (composite >= 75) return VERDICTS.apply;
  if (composite >= 60) return VERDICTS["apply-eyes-open"];
  if (composite >= 45) return VERDICTS.marginal;
  return VERDICTS.skip;
}

// A caution is warranted when any reject-fast flag is set on a score that would
// otherwise read as applyable — the skill says a hard negative can override a
// borderline composite.
export function flagCaution(flags: Flags, verdict: VerdictKey): boolean {
  const anyFlag = REJECT_FLAGS.some((f) => flags[f.key]);
  return anyFlag && (verdict === "apply" || verdict === "apply-eyes-open");
}

// Human-readable assessment for the clipboard / notes — mirrors the skill's
// "scores after the narrative" convention.
export function assessmentSummary(evaln: Evaluation): string {
  const lines = DIMENSIONS.map(
    (d) => `  ${d.label} (${d.weightPct}%): ${evaln.scores[d.key] ?? 0}/10` +
      (evaln.notes[d.key]?.trim() ? ` — ${evaln.notes[d.key]!.trim()}` : ""),
  );
  const setFlags = REJECT_FLAGS.filter((f) => evaln.flags[f.key]).map(
    (f) => `  ⚠ ${f.label}`,
  );
  const v = VERDICTS[evaln.verdict];
  return [
    `Composite: ${evaln.composite}/100 — ${v.label}`,
    "",
    "Dimension scores:",
    ...lines,
    ...(setFlags.length ? ["", "Reject-fast flags:", ...setFlags] : []),
    ...(evaln.conclusion.trim() ? ["", "Conclusion:", evaln.conclusion.trim()] : []),
  ].join("\n");
}
