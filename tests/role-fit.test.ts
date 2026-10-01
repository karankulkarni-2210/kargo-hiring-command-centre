import { describe, expect, it } from "vitest";
import { suggestRole } from "../src/lib/scoring/engine";

const rules = { coverageMinimumPct: 70, maxComparableCoverageGapPct: 15 };

describe("automatic role fit", () => {
  it("compares scores only when coverage is comparable", () => {
    const f = suggestRole({ score: 62, coveragePct: 75 }, { score: 48, coveragePct: 80 }, rules);
    expect(f).toMatchObject({ role: "PM", basis: "score", confidence: "comparable", closeCall: false });
  });

  it("treats a gap under 5 points as a close call decided by evidence", () => {
    const f = suggestRole({ score: 60, coveragePct: 70 }, { score: 63, coveragePct: 80 }, rules);
    expect(f).toMatchObject({ role: "SPM", basis: "coverage", closeCall: true });
  });

  it("does not compare scores below the coverage minimum — uses coverage instead (Arjun Verma's real numbers)", () => {
    const f = suggestRole({ score: 50, coveragePct: 35 }, { score: 36.1, coveragePct: 45 }, rules);
    expect(f).toMatchObject({ role: "SPM", basis: "coverage", confidence: "low" });
    expect(f.reason).toMatch(/can't be compared/);
  });

  it("does not compare scores when coverage differs by more than 15 pp, even above 70%", () => {
    const f = suggestRole({ score: 90, coveragePct: 70 }, { score: 40, coveragePct: 90 }, rules);
    expect(f).toMatchObject({ role: "SPM", basis: "coverage", confidence: "low" });
  });

  it("uses the only scorable role (Arnav Sen: PM not scorable, SPM 50 at 60%)", () => {
    const f = suggestRole({ score: null, coveragePct: 0 }, { score: 50, coveragePct: 60 }, rules);
    expect(f).toMatchObject({ role: "SPM", basis: "only_scorable" });
  });

  it("leaves the role empty when neither role is scorable (Priya Sharma)", () => {
    const f = suggestRole({ score: null, coveragePct: 0 }, { score: null, coveragePct: 0 }, rules);
    expect(f).toMatchObject({ role: null, basis: "none" });
  });

  it("handles a missing evaluation", () => {
    expect(suggestRole(null, { score: 40, coveragePct: 50 }, rules).role).toBe("SPM");
    expect(suggestRole(null, null, rules).role).toBeNull();
  });
});
