import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRubixText, RubricParseError } from "@/lib/rubric/parse-rubix";
import { validateRubric } from "@/lib/rubric/validate";
import { parseRubricSource, verifyAgainstSource } from "@/lib/rubric/import";
import { buildRubricRows, sha256Hex } from "@/lib/rubric/store";

const SOURCE = readFileSync("rubric/Rubix.txt", "utf8");

describe("Rubix.txt import", () => {
  const parsed = parseRubixText(SOURCE);
  const v = validateRubric(parsed);

  it("preserves the declared provisional status and version", () => {
    expect(parsed.versionLabel).toBe("0.1");
    expect(parsed.declaredStatus).toBe("PROVISIONAL");
    expect(parsed.historicalRecordsAvailable).toBe(0);
    expect(v.calibrated).toBe(false);
  });

  it("reads every criterion, weight and evidence mode exactly", () => {
    const pm = parsed.roles.PM.criteria.map((c) => [c.code, c.weight, c.evidenceMode]);
    expect(pm).toEqual([
      ["PM-1", 20, "CV-PARTIAL"],
      ["PM-2", 25, "CV-OK"],
      ["PM-3", 20, "INTERVIEW/WORK-SAMPLE ONLY"],
      ["PM-4", 15, "CV-PARTIAL"],
      ["PM-5", 10, "CV-OK"],
      ["PM-6", 10, "CV-PARTIAL"],
    ]);
    const spm = parsed.roles.SPM.criteria.map((c) => [c.code, c.weight]);
    expect(spm).toEqual([["SPM-1", 25], ["SPM-2", 15], ["SPM-3", 20], ["SPM-4", 10], ["SPM-5", 10], ["SPM-6", 10], ["SPM-7", 10]]);
    expect(parsed.roles.SPM.criteria[1].name).toBe("Autonomous decision ownership in ambiguous, low-structure settings");
  });

  it("keeps all five anchors for every criterion, verbatim", () => {
    for (const role of ["PM", "SPM"] as const)
      for (const c of parsed.roles[role].criteria)
        for (const k of ["1", "2", "3", "4", "5"] as const) expect(c.anchors[k].length).toBeGreaterThan(10);
    expect(parsed.roles.PM.criteria[0].anchors["2"]).toBe("Discovery is secondhand only (sales requests, tickets, surveys). Describes users in generic terms.");
  });

  it("validates that each role's weights total 100%", () => {
    expect(v.ok).toBe(true);
    expect(v.weightTotals).toEqual({ PM: 100, SPM: 100 });
    expect(v.maxCvStageCoveragePct).toEqual({ PM: 80, SPM: 80 });
  });

  it("flags — but does not fix — the 7-criterion SPM scorecard and the missing historical support", () => {
    expect(v.assignmentFit.perRole.SPM).toEqual({ criteriaCount: 7, withinRange: false, historicallySupportedCriteria: 0 });
    expect(v.assignmentFit.perRole.PM.withinRange).toBe(true);
    expect(v.assignmentFit.compliant).toBe(false);
    expect(v.issues.some((i) => i.code === "assignment_criteria_count" && i.role === "SPM")).toBe(true);
    expect(v.issues.some((i) => i.code === "no_historical_support")).toBe(true);
    expect(parsed.roles.SPM.criteria).toHaveLength(7); // not silently trimmed
    for (const c of [...parsed.roles.PM.criteria, ...parsed.roles.SPM.criteria]) {
      expect(c.historicalSupport.supportingCases).toBe(0); // no invented support
      expect(c.patternConfidence).toBe("Not established");
    }
  });

  it("extracts the scoring rules from Section 6", () => {
    expect(parsed.rules.coverageMinimumPct).toBe(70);
    expect(parsed.rules.maxComparableCoverageGapPct).toBe(15);
    expect(parsed.rules.interviewOnlyMustBeNEAtCvStage).toBe(true);
    expect(parsed.rules.lowScoreRequiresExplicitNegativeEvidence).toBe(true);
    expect(parsed.rules.cvPartialConfidenceCap).toBe("Medium");
    expect(parsed.rules.recommendationVocabulary.map((r) => r.step)).toEqual([
      "Collect more evidence",
      "Human review: advance to next stage",
      "Human review: contradictions",
      "Hold: verify essential requirement",
    ]);
  });

  it("resolves essential-requirement rules and essentiality flags", () => {
    const er = Object.fromEntries([...parsed.roles.PM.essentialRequirements, ...parsed.roles.SPM.essentialRequirements].map((e) => [e.code, e]));
    expect(Object.keys(er)).toEqual(["ER-PM-A", "ER-PM-B", "ER-SPM-A", "ER-SPM-B", "ER-SPM-C"]);
    expect(er["ER-SPM-A"].statusRuleResolved).toBe(er["ER-PM-A"].statusRule);
    expect(er["ER-PM-A"].essentialityConfirmed).toBe(true);
    expect(er["ER-PM-B"].essentialityConfirmed).toBe(false);
    expect(er["ER-SPM-C"].essentialityConfirmed).toBe(false);
  });

  it("produces DB rows that keep the original source verbatim", () => {
    const rows = buildRubricRows({ parsed, validation: v, sourceText: SOURCE, sourceFilename: "Rubix.txt", parseMethod: "rubix_text", importedBy: "test" });
    expect(rows.version.source_text).toBe(SOURCE);
    expect(rows.version.source_sha256).toBe("453aa0d31221e897b0ff464c9bcab5da777ee60bfe23d7d12d8b8742a890422c");
    expect(sha256Hex(SOURCE)).toBe(rows.version.source_sha256);
    expect(rows.criteria).toHaveLength(13);
    expect(rows.essentials).toHaveLength(5);
  });
});

describe("rubric replacement", () => {
  it("rejects a rubric whose weights do not total 100%", () => {
    const broken = SOURCE.replace("| PM-2    | Ship, measure, and stop in short cycles              | CV-OK                      | 25", "| PM-2    | Ship, measure, and stop in short cycles              | CV-OK                      | 30").replace(
      "  Weight %:             25  (PROPOSED JUDGMENT; not statistically validated)\n  Score anchors 1-5:    1 = Explicit negative evidence: no shipped",
      "  Weight %:             30  (PROPOSED JUDGMENT; not statistically validated)\n  Score anchors 1-5:    1 = Explicit negative evidence: no shipped",
    );
    const v = validateRubric(parseRubixText(broken));
    expect(v.ok).toBe(false);
    expect(v.weightTotals.PM).toBe(105);
    expect(v.issues.some((i) => i.code === "weights_not_100" && i.role === "PM")).toBe(true);
  });

  it("detects a summary/detail weight mismatch", () => {
    const broken = SOURCE.replace("| PM-6    | Operations workflow understanding                    | CV-PARTIAL                 | 10", "| PM-6    | Operations workflow understanding                    | CV-PARTIAL                 | 15");
    const v = validateRubric(parseRubixText(broken));
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === "summary_weight_mismatch")).toBe(true);
  });

  it("refuses to guess when structure is missing", () => {
    expect(() => parseRubixText("just some text")).toThrow(RubricParseError);
  });

  it("accepts a JSON rubric and verifies it against the source text", () => {
    const parsed = parseRubixText(SOURCE);
    const json = JSON.stringify(parsed);
    const r = parseRubricSource(json, "rubric.json");
    expect(r.method).toBe("json");
    expect(verifyAgainstSource(r.parsed, SOURCE)).toEqual([]);
    const tampered = structuredClone(parsed);
    tampered.roles.PM.criteria[0].name = "Invented criterion";
    tampered.roles.PM.criteria[1].historicalSupport.supportingCases = 3;
    const failures = verifyAgainstSource(tampered, SOURCE);
    expect(failures.some((f) => f.includes("Invented criterion"))).toBe(true);
    expect(failures.some((f) => f.includes("claims 3 supporting"))).toBe(true);
  });
});
