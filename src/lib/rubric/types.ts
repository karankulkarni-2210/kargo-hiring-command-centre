import { z } from "zod";

export const ROLES = ["PM", "SPM"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_TITLES: Record<Role, string> = {
  PM: "Product Manager",
  SPM: "Senior Product Manager",
};

export const EVIDENCE_MODES = ["CV-OK", "CV-PARTIAL", "INTERVIEW/WORK-SAMPLE ONLY"] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export const AnchorsSchema = z.object({
  "1": z.string().min(1),
  "2": z.string().min(1),
  "3": z.string().min(1),
  "4": z.string().min(1),
  "5": z.string().min(1),
});

export const CriterionSchema = z.object({
  code: z.string().regex(/^(PM|SPM)-\d+$/),
  role: z.enum(ROLES),
  name: z.string().min(1),
  evidenceMode: z.enum(EVIDENCE_MODES),
  weight: z.number().positive().max(100),
  weightNote: z.string().default(""),
  expectedOutcome: z.string().default(""),
  basis: z.string().default(""),
  anchors: AnchorsSchema,
  acceptableEvidence: z.string().default(""),
  interviewProbe: z.string().default(""),
  hypothesisRefs: z.array(z.string()).default([]),
  historicalSupport: z.object({
    supportingCases: z.number().int().min(0),
    relevantCases: z.number().int().min(0),
    basis: z.string(),
  }),
  patternConfidence: z.enum(["Not established", "Weak", "Moderate", "Strong"]).default("Not established"),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const EssentialRequirementSchema = z.object({
  code: z.string().min(1),
  role: z.enum(ROLES),
  requirement: z.string().min(1),
  source: z.string().default(""),
  statusRule: z.string().min(1),
  statusRuleResolved: z.string().min(1),
  /** false when the rubric says essentiality is still to be confirmed by the founder. */
  essentialityConfirmed: z.boolean(),
});
export type EssentialRequirement = z.infer<typeof EssentialRequirementSchema>;

export const RoleRubricSchema = z.object({
  role: z.enum(ROLES),
  title: z.string(),
  criteria: z.array(CriterionSchema).min(1),
  essentialRequirements: z.array(EssentialRequirementSchema).default([]),
  /** Weights as stated in the summary table, for cross-checking against the detail records. */
  summaryWeights: z.record(z.string(), z.object({ weight: z.number(), evidenceMode: z.string() })).default({}),
  statedTotal: z.number().nullable().default(null),
});
export type RoleRubric = z.infer<typeof RoleRubricSchema>;

export const RubricRulesSchema = z.object({
  scoreMin: z.literal(1),
  scoreMax: z.literal(5),
  notEnoughEvidenceLabel: z.string().default("NE"),
  coverageMinimumPct: z.number().min(0).max(100),
  maxComparableCoverageGapPct: z.number().min(0).max(100),
  defaultStage: z.string().default("CV screen"),
  interviewOnlyMustBeNEAtCvStage: z.boolean().default(true),
  cvPartialConfidenceCap: z.enum(["Low", "Medium", "High"]).default("Medium"),
  lowScoreRequiresExplicitNegativeEvidence: z.boolean().default(true),
  missingEvidenceNeverScored: z.boolean().default(true),
  noAutomaticThresholds: z.boolean().default(true),
  roundingDecimals: z.number().int().default(1),
  formulaText: z.string().default(""),
  displayFormat: z.string().default("Score XX.X/100 at YY% coverage (stage: <stage>)"),
  scoringRulesText: z.array(z.string()).default([]),
  interpretationLimitsText: z.array(z.string()).default([]),
  recommendationVocabulary: z.array(z.object({ step: z.string(), useWhen: z.string() })).default([]),
  essentialStatuses: z.array(z.object({ status: z.string(), meaning: z.string(), action: z.string() })).default([]),
  confidenceRatings: z.array(z.object({ rating: z.string(), levels: z.string(), definition: z.string() })).default([]),
});
export type RubricRules = z.infer<typeof RubricRulesSchema>;

export const HypothesisSchema = z.object({
  id: z.string(),
  behavior: z.string(),
  roleRelevance: z.string().default(""),
  supportingCases: z.number().int().min(0),
  relevantCases: z.number().int().min(0),
});

export const ParsedRubricSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  versionLabel: z.string(),
  preparedDate: z.string().nullable().default(null),
  declaredStatus: z.string(), // e.g. "PROVISIONAL"
  statusStatement: z.string().default(""),
  historicalMatrixStatus: z.string().default(""),
  historicalRecordsAvailable: z.number().int().min(0).default(0),
  roles: z.object({ PM: RoleRubricSchema, SPM: RoleRubricSchema }),
  hypotheses: z.array(HypothesisSchema).default([]),
  excludedSignals: z.array(z.object({ signal: z.string(), treatment: z.string(), reason: z.string() })).default([]),
  rules: RubricRulesSchema,
  founderQuestions: z.array(z.string()).default([]),
  gaps: z.array(z.object({ id: z.string(), issue: z.string(), effect: z.string() })).default([]),
});
export type ParsedRubric = z.infer<typeof ParsedRubricSchema>;

export type ValidationIssue = { level: "error" | "warning" | "info"; code: string; message: string; role?: Role };

export type RubricValidation = {
  ok: boolean; // no errors => may be activated
  issues: ValidationIssue[];
  weightTotals: Record<Role, number>;
  maxCvStageCoveragePct: Record<Role, number>;
  assignmentFit: {
    requiredCriteriaRange: [number, number];
    requiresHistoricalSupport: boolean;
    perRole: Record<Role, { criteriaCount: number; withinRange: boolean; historicallySupportedCriteria: number }>;
    compliant: boolean;
  };
  calibrated: boolean;
};
