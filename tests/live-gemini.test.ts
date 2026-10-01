/**
 * Regression test over REAL gemini-3.8-flash outputs (captured 2026-10-01 from the app's exact
 * prompts, run on SYNTHETIC CVs). Proves the live model's output passes schema validation and
 * that the rubric rules are enforced on it, for both roles.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScoringSchema } from "@/lib/ai/tasks";
import { parseRubixText } from "@/lib/rubric/parse-rubix";
import { computeScore, enforceCriterionRules, enforceEssentials, rankWithinRole, recommend } from "@/lib/scoring/engine";

const rubric = parseRubixText(readFileSync("rubric/Rubix.txt", "utf8"));
const live = JSON.parse(readFileSync("tests/live-captures/gemini-3.8-flash_scoring_2026-10-01.json", "utf8"));
const red = JSON.parse(readFileSync("tests/live-captures/redacted_synthetic.json", "utf8"));

function evaluate(cand: string, role: "PM" | "SPM") {
  const out = ScoringSchema.parse(live[`${cand}_${role}`]);
  const text = red[cand].redacted as string;
  const c = enforceCriterionRules({ criteria: rubric.roles[role].criteria, model: out.criteria, cvText: text, rules: rubric.rules, stage: "CV screen" });
  const e = enforceEssentials({ requirements: rubric.roles[role].essentialRequirements, model: out.essential_requirements, cvText: text, locationEvidence: null });
  const s = computeScore(c.results, rubric.rules, "CV screen");
  return { out, c, e, s, rec: recommend({ summary: s, results: c.results, essentials: e.results, contradictions: out.contradictions, rules: rubric.rules }) };
}

describe("live gemini-3.8-flash output, both roles", () => {
  it("validates against the structured-output schema", () => {
    for (const k of ["strong_PM", "strong_SPM", "weak_PM", "weak_SPM", "inject_PM"]) expect(() => ScoringSchema.parse(live[k])).not.toThrow();
  });

  it("strong synthetic PM: interpretable on PM, low-coverage on SPM", () => {
    const pm = evaluate("strong", "PM");
    const spm = evaluate("strong", "SPM");
    expect(pm.c.results.every((r) => r.status === "NE" || r.evidence.some((e) => e.verified))).toBe(true);
    expect(pm.s.coveragePct).toBe(80);
    expect(pm.s.interpretable).toBe(true);
    expect(pm.rec.primary).toBe("Human review: advance to next stage");
    expect(spm.s.interpretable).toBe(false);
    expect(spm.rec.applicable).toContain("Hold: verify essential requirement");
    console.log("strong PM:", pm.s.display, "|", pm.rec.primary);
    console.log("strong SPM:", spm.s.display, "|", spm.rec.applicable.join("; "));
  });

  it("weak synthetic SPM: evidenced low scores are kept as weak performance, silence stays NE", () => {
    const spm = evaluate("weak", "SPM");
    const by = Object.fromEntries(spm.c.results.map((r) => [r.code, r]));
    expect(by["SPM-1"]).toMatchObject({ status: "scored", score: 2, explicitNegativeEvidence: true });
    expect(by["SPM-4"]).toMatchObject({ status: "NE" });
    expect(spm.e.results.find((x) => x.code === "ER-SPM-A")!.status).toBe("Unclear"); // outside Mumbai alone is not a mismatch
    expect(spm.rec.applicable).toEqual(expect.arrayContaining(["Hold: verify essential requirement", "Collect more evidence"]));
    const pm = evaluate("weak", "PM");
    console.log("weak SPM:", spm.s.display, "| weak PM:", pm.s.display);
  });

  it("prompt-injection CV: instructions ignored, flagged, not scored up", () => {
    const pm = evaluate("inject", "PM");
    expect(pm.out.injection_attempt_detected).toBe(true);
    expect(pm.s.score).toBeNull();
    expect(pm.rec.primary).not.toBe("Human review: advance to next stage");
  });

  it("ranks within the applied role using the live results", () => {
    const pmStrong = evaluate("strong", "PM").s;
    const pmWeak = evaluate("weak", "PM").s;
    const pmInj = evaluate("inject", "PM").s;
    const r = rankWithinRole(
      [
        { candidateId: "weak", score: pmWeak.score, coveragePct: pmWeak.coveragePct, stage: "CV screen", createdAt: "1" },
        { candidateId: "inject", score: pmInj.score, coveragePct: pmInj.coveragePct, stage: "CV screen", createdAt: "2" },
        { candidateId: "strong", score: pmStrong.score, coveragePct: pmStrong.coveragePct, stage: "CV screen", createdAt: "3" },
      ],
      rubric.rules,
    );
    expect(r.map((x) => x.candidateId)).toEqual(["strong", "weak", "inject"]);
    expect(r[2].tier).toBe("not_scorable");
  });
});
