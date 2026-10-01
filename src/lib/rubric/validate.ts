import type { ParsedRubric, Role, RubricValidation, ValidationIssue } from "./types";

/** Assignment requirement (MESA Case 2, Checkpoint L4·1): 4–6 historically supported criteria per role. */
export const ASSIGNMENT_CRITERIA_RANGE: [number, number] = [4, 6];

const EPS = 1e-6;

export function validateRubric(r: ParsedRubric): RubricValidation {
  const issues: ValidationIssue[] = [];
  const weightTotals = {} as Record<Role, number>;
  const maxCv = {} as Record<Role, number>;
  const perRole = {} as RubricValidation["assignmentFit"]["perRole"];

  for (const role of ["PM", "SPM"] as Role[]) {
    const rr = r.roles[role];
    const codes = new Set<string>();
    let total = 0;
    let cvMax = 0;
    for (const c of rr.criteria) {
      if (codes.has(c.code)) issues.push({ level: "error", code: "duplicate_criterion", role, message: `${c.code} appears more than once` });
      codes.add(c.code);
      if (!Number.isFinite(c.weight) || c.weight <= 0)
        issues.push({ level: "error", code: "invalid_weight", role, message: `${c.code} has an invalid weight` });
      total += c.weight;
      if (c.evidenceMode !== "INTERVIEW/WORK-SAMPLE ONLY") cvMax += c.weight;
      for (const k of ["1", "2", "3", "4", "5"] as const)
        if (!c.anchors[k]?.trim()) issues.push({ level: "error", code: "missing_anchor", role, message: `${c.code} is missing anchor ${k}` });
      const sw = rr.summaryWeights[c.code];
      if (Object.keys(rr.summaryWeights).length) {
        if (!sw) issues.push({ level: "error", code: "summary_missing", role, message: `${c.code} is not in the summary table` });
        else {
          if (Math.abs(sw.weight - c.weight) > EPS)
            issues.push({ level: "error", code: "summary_weight_mismatch", role, message: `${c.code}: summary weight ${sw.weight} ≠ detail weight ${c.weight}` });
          if (sw.evidenceMode !== c.evidenceMode)
            issues.push({ level: "error", code: "summary_mode_mismatch", role, message: `${c.code}: summary mode ${sw.evidenceMode} ≠ detail mode ${c.evidenceMode}` });
        }
      }
    }
    for (const code of Object.keys(rr.summaryWeights))
      if (!codes.has(code)) issues.push({ level: "error", code: "detail_missing", role, message: `${code} is in the summary table but has no full criterion record` });

    weightTotals[role] = Math.round(total * 100) / 100;
    maxCv[role] = Math.round(cvMax * 100) / 100;
    if (Math.abs(total - 100) > EPS)
      issues.push({ level: "error", code: "weights_not_100", role, message: `${role} weights total ${weightTotals[role]}%, not 100%` });
    else issues.push({ level: "info", code: "weights_ok", role, message: `${role} weights total 100%` });
    if (rr.statedTotal !== null && Math.abs(rr.statedTotal - total) > EPS)
      issues.push({ level: "error", code: "stated_total_mismatch", role, message: `${role} stated TOTAL ${rr.statedTotal} ≠ computed ${weightTotals[role]}` });

    const supported = rr.criteria.filter((c) => c.historicalSupport.supportingCases > 0).length;
    const n = rr.criteria.length;
    const within = n >= ASSIGNMENT_CRITERIA_RANGE[0] && n <= ASSIGNMENT_CRITERIA_RANGE[1];
    perRole[role] = { criteriaCount: n, withinRange: within, historicallySupportedCriteria: supported };
    if (!within)
      issues.push({
        level: "warning",
        code: "assignment_criteria_count",
        role,
        message: `${role} has ${n} criteria; the assignment asks for ${ASSIGNMENT_CRITERIA_RANGE[0]}–${ASSIGNMENT_CRITERIA_RANGE[1]} per role. Not changed by the app — correct it in the rubric source.`,
      });
    if (supported < n)
      issues.push({
        level: "warning",
        code: "no_historical_support",
        role,
        message: `${n - supported} of ${n} ${role} criteria have no historical hire support (0 supporting cases); they are JD-derived hypotheses.`,
      });
    if (maxCv[role] < r.rules.coverageMinimumPct)
      issues.push({ level: "warning", code: "coverage_unreachable", role, message: `Max CV-stage coverage ${maxCv[role]}% is below the ${r.rules.coverageMinimumPct}% interpretation minimum` });
    else
      issues.push({ level: "info", code: "max_cv_coverage", role, message: `Max CV-stage coverage for ${role} is ${maxCv[role]}% (interview-only criteria are NE at CV screen)` });
  }

  const provisional = /PROVISIONAL/i.test(r.declaredStatus);
  if (provisional)
    issues.push({ level: "warning", code: "provisional", message: `Rubric declares itself ${r.declaredStatus}: ${r.statusStatement.slice(0, 240)}${r.statusStatement.length > 240 ? "…" : ""}` });
  if (r.historicalRecordsAvailable === 0)
    issues.push({ level: "warning", code: "no_historical_records", message: "Historical outcome matrix is empty (0 hire records). No criterion or weight is calibrated against past hires." });

  const anyUnsupported = (["PM", "SPM"] as Role[]).some((ro) => perRole[ro].historicallySupportedCriteria < perRole[ro].criteriaCount);
  const compliant = (["PM", "SPM"] as Role[]).every((ro) => perRole[ro].withinRange) && !anyUnsupported;
  const calibrated = !provisional && r.historicalRecordsAvailable > 0 && !anyUnsupported;

  return {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    weightTotals,
    maxCvStageCoveragePct: maxCv,
    assignmentFit: { requiredCriteriaRange: ASSIGNMENT_CRITERIA_RANGE, requiresHistoricalSupport: true, perRole, compliant },
    calibrated,
  };
}
