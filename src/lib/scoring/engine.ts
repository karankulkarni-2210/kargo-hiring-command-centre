/**
 * Rubric rule enforcement + weighted scoring. Pure functions, no I/O.
 *
 * The AI proposes criterion-level judgments; this module decides what is allowed to count.
 * Weighted totals are always computed here, never taken from a model.
 */
import type { Criterion, EssentialRequirement, RubricRules } from "../rubric/types";
import type { Role } from "../rubric/types";

export type Confidence = "Low" | "Medium" | "High";
const CONF_ORDER: Confidence[] = ["Low", "Medium", "High"];

export type ModelCriterion = {
  criterion_code: string;
  assessment: "scored" | "NE";
  score: number | null;
  evidence: { quote: string; location?: string | null }[];
  reasoning: string;
  confidence: Confidence | null;
  explicit_negative_evidence: boolean;
};

export type ModelEssential = {
  code: string;
  status: "Confirmed" | "Unclear" | "Evidence of mismatch";
  evidence_quote: string | null;
  reasoning: string;
};

export type NEReason =
  | "interview_only_at_cv_stage"
  | "model_marked_NE"
  | "missing_from_model_output"
  | "no_evidence_cited"
  | "evidence_not_found_in_cv"
  | "low_score_without_explicit_negative_evidence"
  | "invalid_score";

export type CriterionResult = {
  code: string;
  name: string;
  weight: number;
  evidenceMode: Criterion["evidenceMode"];
  status: "scored" | "NE";
  score: number | null;
  neReason: NEReason | null;
  evidence: { quote: string; location: string | null; verified: boolean }[];
  reasoning: string;
  confidence: Confidence | null;
  explicitNegativeEvidence: boolean;
  reScoreAfterInterview: boolean;
};

export type EssentialResult = {
  code: string;
  requirement: string;
  status: "Confirmed" | "Unclear" | "Evidence of mismatch";
  evidence: string | null;
  reasoning: string;
  essentialityConfirmed: boolean;
};

export type EnforcementLogEntry = { code: string; rule: string; change: string };

/** Normalise text for evidence matching (case, whitespace, quote/dash variants). */
export function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•▪●◦·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A quote counts only if it (or every ≥12-char fragment around an ellipsis) appears in the CV text. */
export function quoteAppearsIn(quote: string, haystackNorm: string): boolean {
  const q = normaliseForMatch(quote).replace(/^["']|["']$/g, "");
  if (q.length < 8) return false;
  if (haystackNorm.includes(q)) return true;
  const frags = q.split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/).filter((f) => f.length > 0);
  if (frags.length > 1 && frags.every((f) => f.length >= 12 && haystackNorm.includes(f))) return true;
  return false;
}

function capConfidence(c: Confidence | null, cap: Confidence): Confidence | null {
  if (!c) return null;
  return CONF_ORDER.indexOf(c) > CONF_ORDER.indexOf(cap) ? cap : c;
}

export function enforceCriterionRules(params: {
  criteria: Criterion[];
  model: ModelCriterion[];
  cvText: string;
  rules: RubricRules;
  stage: string;
}): { results: CriterionResult[]; log: EnforcementLogEntry[] } {
  const { criteria, model, cvText, rules, stage } = params;
  const hay = normaliseForMatch(cvText);
  const byCode = new Map(model.map((m) => [m.criterion_code.trim().toUpperCase(), m]));
  const log: EnforcementLogEntry[] = [];
  const isCvStage = /cv/i.test(stage);

  for (const m of model) {
    if (!criteria.some((c) => c.code === m.criterion_code.trim().toUpperCase()))
      log.push({ code: m.criterion_code, rule: "unknown criterion", change: "ignored — not in active rubric" });
  }

  const results = criteria.map((c): CriterionResult => {
    const m = byCode.get(c.code);
    const base: CriterionResult = {
      code: c.code,
      name: c.name,
      weight: c.weight,
      evidenceMode: c.evidenceMode,
      status: "NE",
      score: null,
      neReason: null,
      evidence: [],
      reasoning: m?.reasoning?.trim() ?? "",
      confidence: null,
      explicitNegativeEvidence: Boolean(m?.explicit_negative_evidence),
      reScoreAfterInterview: c.evidenceMode !== "CV-OK",
    };
    const ne = (reason: NEReason, rule?: string): CriterionResult => {
      if (rule && m && m.assessment === "scored" && m.score !== null)
        log.push({ code: c.code, rule, change: `model score ${m.score} → NE` });
      return { ...base, status: "NE", score: null, confidence: null, neReason: reason };
    };

    if (!m) {
      log.push({ code: c.code, rule: "6.1 absence of evidence is NE", change: "criterion missing from model output → NE" });
      return ne("missing_from_model_output");
    }

    base.evidence = (m.evidence ?? [])
      .filter((e) => e && typeof e.quote === "string" && e.quote.trim())
      .slice(0, 4)
      .map((e) => ({ quote: e.quote.trim(), location: e.location?.trim() || null, verified: quoteAppearsIn(e.quote, hay) }));

    if (isCvStage && rules.interviewOnlyMustBeNEAtCvStage && c.evidenceMode === "INTERVIEW/WORK-SAMPLE ONLY")
      return ne("interview_only_at_cv_stage", "6.1 interview/work-sample-only criteria must be NE at CV screen");

    if (m.assessment !== "scored" || m.score === null) return ne("model_marked_NE");

    if (!Number.isInteger(m.score) || m.score < rules.scoreMin || m.score > rules.scoreMax)
      return ne("invalid_score", `score must be an integer ${rules.scoreMin}-${rules.scoreMax}`);

    const verified = base.evidence.filter((e) => e.verified);
    if (base.evidence.length === 0) return ne("no_evidence_cited", "6.1 a score requires evidence matching an anchor");
    if (verified.length === 0) return ne("evidence_not_found_in_cv", "cited evidence must appear verbatim in the CV text");

    // 6.1: a 1-2 needs explicit negative evidence = "something the candidate said, wrote or did that matches
    // the low anchor". A verbatim, verified CV quote cited for the low score is exactly that; the model's own
    // boolean flag is advisory only (live testing showed it is applied inconsistently).
    if (rules.lowScoreRequiresExplicitNegativeEvidence && m.score <= 2) {
      if (verified.length === 0) return ne("low_score_without_explicit_negative_evidence", "6.1 a 1-2 requires explicit negative evidence; silence is NE");
      base.explicitNegativeEvidence = true;
      if (!m.explicit_negative_evidence)
        log.push({ code: c.code, rule: "6.1 explicit negative evidence", change: "low score kept: backed by verified CV quote (model flag was false)" });
    }

    let conf = m.confidence ?? "Low";
    if (c.evidenceMode === "CV-PARTIAL") {
      const capped = capConfidence(conf, rules.cvPartialConfidenceCap)!;
      if (capped !== conf) log.push({ code: c.code, rule: "6.1 CV-PARTIAL confidence capped", change: `${conf} → ${capped}` });
      conf = capped;
    }
    if (isCvStage && conf === "High") {
      // 6.5: High = verified by a work sample or multiple sources including interview — impossible at CV screen.
      log.push({ code: c.code, rule: "6.5 High requires work sample/interview verification", change: "High → Medium" });
      conf = "Medium";
    }
    return { ...base, status: "scored", score: m.score, confidence: conf, neReason: null };
  });

  return { results, log };
}

export type ScoreSummary = {
  coveragePct: number;
  score: number | null; // null => "Not scorable"
  scorable: boolean;
  interpretable: boolean; // coverage at or above the rubric minimum
  display: string;
};

/** 6.2: coverage = Σw(scored); score = 100 × Σ[w(s−1)/4] / Σw(scored). */
export function computeScore(results: CriterionResult[], rules: RubricRules, stage: string): ScoreSummary {
  const scored = results.filter((r) => r.status === "scored" && r.score !== null);
  const coverage = scored.reduce((a, r) => a + r.weight, 0);
  const coveragePct = Math.round(coverage * 100) / 100;
  if (scored.length === 0)
    return { coveragePct: 0, score: null, scorable: false, interpretable: false, display: `Not scorable at 0% coverage (stage: ${stage})` };
  const num = scored.reduce((a, r) => a + (r.weight * ((r.score as number) - 1)) / 4, 0);
  const factor = 10 ** rules.roundingDecimals;
  const score = Math.round(((100 * num) / coverage) * factor) / factor;
  const covLabel = Number.isInteger(coveragePct) ? `${coveragePct}` : coveragePct.toFixed(1);
  return {
    coveragePct,
    score,
    scorable: true,
    interpretable: coveragePct >= rules.coverageMinimumPct,
    display: `Score ${score.toFixed(rules.roundingDecimals)}/100 at ${covLabel}% coverage (stage: ${stage})`,
  };
}

/** Apply 6.4 to model-proposed essential requirement statuses. Never produces a rejection. */
export function enforceEssentials(params: {
  requirements: EssentialRequirement[];
  model: ModelEssential[];
  cvText: string;
  locationEvidence: string | null;
}): { results: EssentialResult[]; log: EnforcementLogEntry[] } {
  const hay = normaliseForMatch(params.cvText);
  const log: EnforcementLogEntry[] = [];
  const byCode = new Map(params.model.map((m) => [m.code.trim().toUpperCase(), m]));
  const results = params.requirements.map((req): EssentialResult => {
    const m = byCode.get(req.code.toUpperCase());
    const base = { code: req.code, requirement: req.requirement, essentialityConfirmed: req.essentialityConfirmed };
    if (!m) return { ...base, status: "Unclear", evidence: null, reasoning: "Not assessed by the model; flagged for verification." };
    let status = m.status;
    const q = m.evidence_quote?.trim() || null;
    const supported =
      !!q && (quoteAppearsIn(q, hay) || (!!params.locationEvidence && normaliseForMatch(q).includes(normaliseForMatch(params.locationEvidence))) || /^location signal/i.test(q));
    if (status !== "Unclear" && !supported) {
      log.push({ code: req.code, rule: "6.4 status needs cited evidence", change: `${status} → Unclear (no verifiable evidence)` });
      status = "Unclear";
    }
    if (status === "Evidence of mismatch" && !req.essentialityConfirmed) {
      log.push({ code: req.code, rule: "6.4 mismatch only against a founder-confirmed requirement", change: "Evidence of mismatch → Unclear" });
      status = "Unclear";
    }
    return { ...base, status, evidence: q, reasoning: m.reasoning?.trim() ?? "" };
  });
  return { results, log };
}

export type Recommendation = {
  primary: string;
  applicable: string[];
  reasons: string[];
};

/** 6.6 vocabulary. A recommendation never authorises contact, advancement or decline. */
export function recommend(params: {
  summary: ScoreSummary;
  results: CriterionResult[];
  essentials: EssentialResult[];
  contradictions: { description: string }[];
  rules: RubricRules;
}): Recommendation {
  const { summary, results, essentials, contradictions, rules } = params;
  const applicable: string[] = [];
  const reasons: string[] = [];
  if (contradictions.length) {
    applicable.push("Human review: contradictions");
    reasons.push(`${contradictions.length} possible contradiction(s) in the CV evidence.`);
  }
  const flagged = essentials.filter((e) => e.status !== "Confirmed");
  if (flagged.length) {
    applicable.push("Hold: verify essential requirement");
    reasons.push(`Essential requirement(s) ${flagged.map((e) => `${e.code} ${e.status}`).join(", ")}.`);
  }
  if (!summary.interpretable) {
    applicable.push("Collect more evidence");
    reasons.push(
      summary.scorable
        ? `Coverage ${summary.coveragePct}% is below the ${rules.coverageMinimumPct}% minimum; the total score should not be interpreted.`
        : "No criterion could be scored from the CV evidence.",
    );
  }
  const ne = results.filter((r) => r.status === "NE").map((r) => r.code);
  if (ne.length) reasons.push(`Not enough evidence (NE): ${ne.join(", ")}.`);
  if (!applicable.length) {
    applicable.push("Human review: advance to next stage");
    reasons.push(`Coverage ${summary.coveragePct}% meets the ${rules.coverageMinimumPct}% minimum and no essential requirement is flagged. Suggestion only — the founder decides.`);
  }
  return { primary: applicable[0], applicable, reasons };
}

// ---------------------------------------------------------------------------
// Ranking within the applied role (6.3 comparability rules)
// ---------------------------------------------------------------------------
export type RankInput = { candidateId: string; score: number | null; coveragePct: number; stage: string; createdAt: string };
export type RankOutput = RankInput & { rank: number; tier: "interpretable" | "low_coverage" | "not_scorable"; band: number; inTop5: boolean };

/**
 * Candidates are only ordered by score against peers at the same stage whose coverage is within
 * the rubric's comparable gap. Below-minimum coverage is ranked by coverage, because its score is
 * not interpretable.
 */
export function rankWithinRole(rows: RankInput[], rules: RubricRules, topN = 5): RankOutput[] {
  const interp = rows.filter((r) => r.score !== null && r.coveragePct >= rules.coverageMinimumPct);
  const low = rows.filter((r) => r.score !== null && r.coveragePct < rules.coverageMinimumPct);
  const none = rows.filter((r) => r.score === null);

  const byCovDesc = (a: RankInput, b: RankInput) => b.coveragePct - a.coveragePct || a.createdAt.localeCompare(b.createdAt);
  const out: RankOutput[] = [];
  let band = 0;

  // Group interpretable candidates into comparability bands (stage + coverage gap), then order by score.
  const stages = Array.from(new Set(interp.map((r) => r.stage)));
  for (const stage of stages) {
    const pool = interp.filter((r) => r.stage === stage).sort(byCovDesc);
    while (pool.length) {
      const top = pool[0].coveragePct;
      const members = pool.filter((r) => top - r.coveragePct <= rules.maxComparableCoverageGapPct);
      for (const m of members) pool.splice(pool.indexOf(m), 1);
      band++;
      members
        .sort((a, b) => (b.score as number) - (a.score as number) || b.coveragePct - a.coveragePct || a.createdAt.localeCompare(b.createdAt))
        .forEach((m) => out.push({ ...m, rank: 0, tier: "interpretable", band, inTop5: false }));
    }
  }
  band++;
  low
    .sort((a, b) => b.coveragePct - a.coveragePct || (b.score as number) - (a.score as number) || a.createdAt.localeCompare(b.createdAt))
    .forEach((m) => out.push({ ...m, rank: 0, tier: "low_coverage", band, inTop5: false }));
  band++;
  none.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((m) => out.push({ ...m, rank: 0, tier: "not_scorable", band, inTop5: false }));

  out.forEach((r, i) => {
    r.rank = i + 1;
    r.inTop5 = i < topN && r.tier !== "not_scorable";
  });
  return out;
}

// ---------------------------------------------------------------------------
// Role fit: which of PM / SPM this CV is ranked in. Automatic; the founder can override.
// Follows the rubric's comparison limits (§6.3): scores are compared only when both roles are at
// or above the coverage minimum AND their coverage differs by no more than the comparability gap.
// Otherwise the role with more evidenced rubric weight (coverage) wins, and the fit is marked
// low-confidence. Experience years are never used (C3: age-proxy risk).
// ---------------------------------------------------------------------------
export type FitInput = { score: number | null; coveragePct: number } | null;
export type RoleFit = {
  role: Role | null;
  basis: "score" | "coverage" | "only_scorable" | "none";
  confidence: "comparable" | "low" | "none";
  closeCall: boolean;
  reason: string;
  pm: { score: number | null; coveragePct: number } | null;
  spm: { score: number | null; coveragePct: number } | null;
};

/** Score differences below this are within anchoring noise (§6.3: "a few points"). */
export const FIT_NOISE_POINTS = 5;

export function suggestRole(pm: FitInput, spm: FitInput, rules: Pick<RubricRules, "coverageMinimumPct" | "maxComparableCoverageGapPct">): RoleFit {
  const snap = (x: FitInput) => (x ? { score: x.score, coveragePct: x.coveragePct } : null);
  const base = { pm: snap(pm), spm: snap(spm) };
  const pmOk = pm?.score !== null && pm !== null;
  const spmOk = spm?.score !== null && spm !== null;
  const fmt = (r: Role, x: NonNullable<FitInput>) => `${r} ${x.score === null ? "not scorable" : x.score.toFixed(1)} at ${x.coveragePct}% coverage`;

  if (!pmOk && !spmOk)
    return { ...base, role: null, basis: "none", confidence: "none", closeCall: false, reason: "No scorable evidence for either role. Choose a role manually." };
  if (pmOk !== spmOk) {
    const role: Role = pmOk ? "PM" : "SPM";
    const other: Role = pmOk ? "SPM" : "PM";
    return { ...base, role, basis: "only_scorable", confidence: "low", closeCall: false, reason: `Only ${role} has scorable evidence (${fmt(role, (pmOk ? pm : spm)!)}); ${other} is not scorable.` };
  }
  const a = pm!;
  const b = spm!;
  const comparable =
    a.coveragePct >= rules.coverageMinimumPct && b.coveragePct >= rules.coverageMinimumPct && Math.abs(a.coveragePct - b.coveragePct) <= rules.maxComparableCoverageGapPct;
  const both = `${fmt("PM", a)} vs ${fmt("SPM", b)}`;
  if (comparable) {
    const diff = (a.score as number) - (b.score as number);
    if (Math.abs(diff) < FIT_NOISE_POINTS) {
      const role: Role = a.coveragePct === b.coveragePct ? (diff >= 0 ? "PM" : "SPM") : a.coveragePct > b.coveragePct ? "PM" : "SPM";
      return { ...base, role, basis: "coverage", confidence: "comparable", closeCall: true, reason: `Close call: scores are within ${FIT_NOISE_POINTS} points (${both}), so the role with more evidence was chosen. Worth a human look.` };
    }
    const role: Role = diff > 0 ? "PM" : "SPM";
    return { ...base, role, basis: "score", confidence: "comparable", closeCall: false, reason: `Higher score with comparable coverage (${both}).` };
  }
  if (a.coveragePct === b.coveragePct) {
    const role: Role = (a.score as number) >= (b.score as number) ? "PM" : "SPM";
    return { ...base, role, basis: "score", confidence: "low", closeCall: true, reason: `Equal coverage below the ${rules.coverageMinimumPct}% minimum (${both}); higher score chosen, but scores are not interpretable yet.` };
  }
  const role: Role = a.coveragePct > b.coveragePct ? "PM" : "SPM";
  return {
    ...base,
    role,
    basis: "coverage",
    confidence: "low",
    closeCall: false,
    reason: `Scores can't be compared yet (needs ≥${rules.coverageMinimumPct}% coverage in both and ≤${rules.maxComparableCoverageGapPct} pp apart): ${both}. Assigned to the role with more evidence in the CV.`,
  };
}
