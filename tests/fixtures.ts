/**
 * MOCKED model outputs for SYNTHETIC CVs (fixtures/synthetic-cvs). These are hand-written test
 * doubles of what Gemini might return — they are NOT real evaluations and NOT real candidates.
 * They deliberately include rule violations to prove the app enforces the rubric itself.
 */
import { readFileSync } from "node:fs";
import type { ModelCriterion, ModelEssential } from "@/lib/scoring/engine";

export const cv = (f: string) => readFileSync(`fixtures/synthetic-cvs/${f}`, "utf8");

const sc = (code: string, score: number | null, quotes: string[], extra: Partial<ModelCriterion> = {}): ModelCriterion => ({
  criterion_code: code,
  assessment: score === null ? "NE" : "scored",
  score,
  evidence: quotes.map((q) => ({ quote: q, location: "EXPERIENCE" })),
  reasoning: "mock",
  confidence: score === null ? null : "Medium",
  explicit_negative_evidence: false,
  ...extra,
});

// Strong PM synthetic CV, scored against the PM rubric.
export const STRONG_PM_vs_PM: ModelCriterion[] = [
  sc("PM-1", 4, ["Spent two days a month on the floor of three freight forwarders' operations teams"], { confidence: "High" }), // High must be capped
  sc("PM-2", 5, ["Killed the \"auto-ETA email\" feature after 6 weeks when only 4% of customers opened it"]),
  sc("PM-3", 4, ["changed our Q3 roadmap from a dashboard to an exception inbox"]), // interview-only: must become NE
  sc("PM-4", 4, ["kept a refined backlog two to three sprints ahead with the engineering lead"]),
  sc("PM-5", 3, ["Set up a weekly decision log and a monthly outcome review"]),
  sc("PM-6", 4, ["Mapped the bill-of-lading and delivery-order workflow with customer ops users"]),
];

// Same strong PM CV, scored against the SPM rubric (both-role scoring).
export const STRONG_PM_vs_SPM: ModelCriterion[] = [
  sc("SPM-1", null, []),
  sc("SPM-2", 3, ["moved the two engineers to document-checklist automation"]),
  sc("SPM-3", null, []),
  sc("SPM-4", null, []),
  sc("SPM-5", null, []),
  sc("SPM-6", 3, ["Mapped the bill-of-lading and delivery-order workflow with customer ops users"]),
  sc("SPM-7", 1, []), // silence turned into a 1 — must become NE
];

// Weak SPM CV: explicit negative evidence for some criteria, silence for others.
export const WEAK_SPM_vs_SPM: ModelCriterion[] = [
  sc("SPM-1", 2, ["Delivered integration tickets to the spec provided by the architecture team."], { explicit_negative_evidence: true }),
  sc("SPM-2", 2, ["Wrote user stories when requested by the Group PM, who decided the roadmap."], { explicit_negative_evidence: true }),
  sc("SPM-3", null, []),
  sc("SPM-4", 1, ["Treats reliability as engineering's problem"]), // fabricated quote: not in CV
  sc("SPM-5", 2, []), // low score, no evidence at all
  sc("SPM-6", null, []),
  // SPM-7 omitted entirely by the model
];
export const WEAK_SPM_vs_PM: ModelCriterion[] = [
  sc("PM-1", 1, ["requirements should come from the business stakeholders and sales"], { explicit_negative_evidence: true }),
  sc("PM-2", 2, ["Worked on the loyalty app as part of a team of 12 PMs."], { explicit_negative_evidence: true }),
  sc("PM-3", null, []),
  sc("PM-4", 2, ["Wrote user stories when requested by the Group PM"], { explicit_negative_evidence: true }),
  sc("PM-5", 2, ["I prefer clear processes"], { explicit_negative_evidence: true }),
  sc("PM-6", null, []),
];

export const ESS_STRONG_PM: ModelEssential[] = [
  { code: "ER-PM-A", status: "Confirmed", evidence_quote: "Location signal: Mumbai-based", reasoning: "" },
  { code: "ER-PM-B", status: "Confirmed", evidence_quote: "Product Manager — ShipLane (Series A freight visibility startup), Mumbai | Jan 2022 – Present", reasoning: "" },
];
export const ESS_WEAK_SPM: ModelEssential[] = [
  { code: "ER-SPM-A", status: "Evidence of mismatch", evidence_quote: "Location signal: Located outside Mumbai", reasoning: "outside Mumbai" }, // location alone is NOT a mismatch
  { code: "ER-SPM-B", status: "Evidence of mismatch", evidence_quote: "Associate Product Manager — Large Retail Corp", reasoning: "under 5 years" }, // essentiality unconfirmed
  { code: "ER-SPM-C", status: "Confirmed", evidence_quote: null, reasoning: "" }, // no evidence
];
