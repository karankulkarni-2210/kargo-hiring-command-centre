import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRubixText } from "@/lib/rubric/parse-rubix";
import { computeScore, enforceCriterionRules, enforceEssentials, rankWithinRole, recommend, type CriterionResult } from "@/lib/scoring/engine";
import { preRedactContacts, redactIdentity } from "@/lib/redaction";
import { cv, ESS_STRONG_PM, ESS_WEAK_SPM, STRONG_PM_vs_PM, STRONG_PM_vs_SPM, WEAK_SPM_vs_PM, WEAK_SPM_vs_SPM } from "./fixtures";

const rubric = parseRubixText(readFileSync("rubric/Rubix.txt", "utf8"));
const rules = rubric.rules;
const STAGE = "CV screen";

function redacted(file: string, name: string) {
  const pre = preRedactContacts(cv(file));
  return redactIdentity(pre.text, { fullName: name, locationText: null, sensitiveLines: [], emails: pre.captured.emails, phones: pre.captured.phones }).text;
}

describe("6.2 formula (application code, not the model)", () => {
  it("reproduces the rubric's worked example: 64.3/100 at 70% coverage", () => {
    const mk = (code: string, weight: number, score: number | null): CriterionResult => ({
      code, name: code, weight, evidenceMode: "CV-OK", status: score === null ? "NE" : "scored", score, neReason: null, evidence: [], reasoning: "", confidence: null, explicitNegativeEvidence: false, reScoreAfterInterview: false,
    });
    const s = computeScore([mk("PM-1", 20, 4), mk("PM-2", 25, 3), mk("PM-3", 20, null), mk("PM-4", 15, 5), mk("PM-5", 10, null), mk("PM-6", 10, 2)], rules, STAGE);
    expect(s.coveragePct).toBe(70);
    expect(s.score).toBe(64.3);
    expect(s.display).toBe("Score 64.3/100 at 70% coverage (stage: CV screen)");
    expect(s.interpretable).toBe(true);
  });

  it("returns Not scorable when nothing is scored — never 0", () => {
    const s = computeScore([], rules, STAGE);
    expect(s.score).toBeNull();
    expect(s.scorable).toBe(false);
    expect(s.display).toMatch(/^Not scorable/);
  });
});

describe("missing-evidence rules are enforced on model output", () => {
  const text = redacted("SYNTHETIC_strong_PM_Asha_Varma.txt", "Asha Varma");

  it("forces interview-only PM-3 to NE at CV screen and caps confidence", () => {
    const { results, log } = enforceCriterionRules({ criteria: rubric.roles.PM.criteria, model: STRONG_PM_vs_PM, cvText: text, rules, stage: STAGE });
    const by = Object.fromEntries(results.map((r) => [r.code, r]));
    expect(by["PM-3"].status).toBe("NE");
    expect(by["PM-3"].neReason).toBe("interview_only_at_cv_stage");
    expect(by["PM-1"].confidence).toBe("Medium"); // High capped (CV-PARTIAL)
    expect(results.every((r) => r.confidence !== "High")).toBe(true);
    expect(log.some((l) => l.code === "PM-3")).toBe(true);
    const s = computeScore(results, rules, STAGE);
    expect(s.coveragePct).toBe(80); // max CV-stage coverage
    // (20*.75 + 25*1 + 15*.75 + 10*.5 + 10*.75) / 80 * 100
    expect(s.score).toBe(79.7);
  });

  it("turns silence into NE, not a 1", () => {
    const { results } = enforceCriterionRules({ criteria: rubric.roles.SPM.criteria, model: STRONG_PM_vs_SPM, cvText: text, rules, stage: STAGE });
    const spm7 = results.find((r) => r.code === "SPM-7")!;
    expect(spm7.status).toBe("NE");
    expect(spm7.score).toBeNull();
    expect(["no_evidence_cited", "low_score_without_explicit_negative_evidence"]).toContain(spm7.neReason);
  });

  it("distinguishes weak demonstrated performance from insufficient evidence", () => {
    const weakText = redacted("SYNTHETIC_weak_SPM_Rohit_Kale.txt", "Rohit Kale");
    const { results } = enforceCriterionRules({ criteria: rubric.roles.SPM.criteria, model: WEAK_SPM_vs_SPM, cvText: weakText, rules, stage: STAGE });
    const by = Object.fromEntries(results.map((r) => [r.code, r]));
    expect(by["SPM-1"]).toMatchObject({ status: "scored", score: 2, explicitNegativeEvidence: true }); // weak, evidenced
    expect(by["SPM-2"]).toMatchObject({ status: "scored", score: 2 });
    expect(by["SPM-4"]).toMatchObject({ status: "NE", neReason: "evidence_not_found_in_cv" }); // fabricated quote rejected
    expect(by["SPM-5"]).toMatchObject({ status: "NE", neReason: "no_evidence_cited" });
    expect(by["SPM-7"]).toMatchObject({ status: "NE", neReason: "missing_from_model_output" });
    expect(by["SPM-3"].neReason).toBe("interview_only_at_cv_stage");
    const s = computeScore(results, rules, STAGE);
    expect(s.coveragePct).toBe(40);
    expect(s.score).toBe(25);
    expect(s.interpretable).toBe(false);
  });
});

describe("essential requirements (6.4) never reject", () => {
  it("downgrades unsupported or unconfirmed mismatches to Unclear", () => {
    const weakText = redacted("SYNTHETIC_weak_SPM_Rohit_Kale.txt", "Rohit Kale");
    const { results } = enforceEssentials({ requirements: rubric.roles.SPM.essentialRequirements, model: ESS_WEAK_SPM, cvText: weakText, locationEvidence: null });
    const by = Object.fromEntries(results.map((r) => [r.code, r.status]));
    // ER-SPM-A: rubric allows mismatch only on an explicit refusal; the model's claim is accepted by
    // this layer only when evidence is cited, and the prompt forbids treating location alone as mismatch.
    expect(by["ER-SPM-B"]).toBe("Unclear"); // essentiality not founder-confirmed
    expect(by["ER-SPM-C"]).toBe("Unclear"); // no evidence
  });
});

describe("both-role scoring, recommendation and ranking", () => {
  const strongText = redacted("SYNTHETIC_strong_PM_Asha_Varma.txt", "Asha Varma");
  const weakText = redacted("SYNTHETIC_weak_SPM_Rohit_Kale.txt", "Rohit Kale");
  const evalFor = (role: "PM" | "SPM", model: typeof STRONG_PM_vs_PM, text: string, ess: typeof ESS_STRONG_PM) => {
    const c = enforceCriterionRules({ criteria: rubric.roles[role].criteria, model, cvText: text, rules, stage: STAGE });
    const e = enforceEssentials({ requirements: rubric.roles[role].essentialRequirements, model: ess, cvText: text, locationEvidence: null });
    const s = computeScore(c.results, rules, STAGE);
    return { s, rec: recommend({ summary: s, results: c.results, essentials: e.results, contradictions: [], rules }), e };
  };

  it("produces an evaluation for BOTH roles for every candidate", () => {
    const a = { PM: evalFor("PM", STRONG_PM_vs_PM, strongText, ESS_STRONG_PM), SPM: evalFor("SPM", STRONG_PM_vs_SPM, strongText, []) };
    const b = { PM: evalFor("PM", WEAK_SPM_vs_PM, weakText, []), SPM: evalFor("SPM", WEAK_SPM_vs_SPM, weakText, ESS_WEAK_SPM) };
    for (const x of [a, b]) for (const role of ["PM", "SPM"] as const) expect(x[role].s.display).toMatch(/coverage \(stage: CV screen\)/);
    expect(a.PM.rec.primary).toBe("Human review: advance to next stage");
    expect(a.SPM.rec.applicable).toContain("Collect more evidence");
    expect(b.SPM.rec.applicable).toContain("Hold: verify essential requirement");
    expect(b.SPM.rec.applicable).toContain("Collect more evidence");
  });

  it("orders by score only among comparable coverage; low coverage is ranked by coverage", () => {
    const ranked = rankWithinRole(
      [
        { candidateId: "low-cov-high-score", score: 95, coveragePct: 40, stage: STAGE, createdAt: "2026-01-01" },
        { candidateId: "a", score: 70, coveragePct: 80, stage: STAGE, createdAt: "2026-01-02" },
        { candidateId: "b", score: 82, coveragePct: 75, stage: STAGE, createdAt: "2026-01-03" },
        { candidateId: "none", score: null, coveragePct: 0, stage: STAGE, createdAt: "2026-01-04" },
        { candidateId: "mid", score: 50, coveragePct: 65, stage: STAGE, createdAt: "2026-01-05" },
      ],
      rules,
    );
    expect(ranked.map((r) => r.candidateId)).toEqual(["b", "a", "mid", "low-cov-high-score", "none"]);
    expect(ranked.find((r) => r.candidateId === "low-cov-high-score")!.tier).toBe("low_coverage");
    expect(ranked.find((r) => r.candidateId === "none")!.inTop5).toBe(false);
    expect(ranked.filter((r) => r.inTop5)).toHaveLength(4);
  });

  it("re-ranks correctly as candidates are added (top five changes, nothing else happens)", () => {
    const base = Array.from({ length: 5 }, (_, i) => ({ candidateId: `c${i}`, score: 60 + i, coveragePct: 80, stage: STAGE, createdAt: `2026-01-0${i + 1}` }));
    const before = rankWithinRole(base, rules).filter((r) => r.inTop5).map((r) => r.candidateId);
    const after = rankWithinRole([...base, { candidateId: "new", score: 90, coveragePct: 80, stage: STAGE, createdAt: "2026-02-01" }], rules);
    expect(before).toContain("c0");
    expect(after[0].candidateId).toBe("new");
    expect(after.find((r) => r.candidateId === "c0")!.inTop5).toBe(false);
  });
});
