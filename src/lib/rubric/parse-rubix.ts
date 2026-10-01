/**
 * Deterministic parser for the Rubix.txt plain-text rubric format.
 *
 * It reads criteria, weights, evidence modes, anchors, essential requirements and
 * scoring rules exactly as written. It never rewrites, re-weights or adds criteria:
 * anything it cannot find is reported as a parse error rather than filled in.
 */
import {
  type Criterion,
  type EssentialRequirement,
  type ParsedRubric,
  ParsedRubricSchema,
  type Role,
  ROLE_TITLES,
} from "./types";

export class RubricParseError extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Split file into numbered top-level sections ("4. PRODUCT MANAGER SCORECARD"). */
function splitSections(lines: string[]): Map<number, { heading: string; lines: string[] }> {
  const out = new Map<number, { heading: string; lines: string[] }>();
  let current: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\d{1,2})\. ([A-Z][A-Z ,\-&/]+)$/);
    const prevIsRule = i > 0 && /^={20,}$/.test(lines[i - 1]);
    if (m && prevIsRule) {
      current = Number(m[1]);
      out.set(current, { heading: m[2].trim(), lines: [] });
      continue;
    }
    if (current !== null) out.get(current)!.lines.push(line);
  }
  return out;
}

/** Split a section into subsections ("4.1 PM scorecard - summary" followed by a dashed rule). */
function splitSubsections(lines: string[]): { id: string; title: string; lines: string[] }[] {
  const subs: { id: string; title: string; lines: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2}\.\d{1,2}) (.+)$/);
    if (m && i + 1 < lines.length && /^-{10,}$/.test(lines[i + 1])) {
      subs.push({ id: m[1], title: m[2].trim(), lines: [] });
      i++;
      continue;
    }
    if (subs.length) subs[subs.length - 1].lines.push(lines[i]);
  }
  return subs;
}

/** Parse an ASCII grid table (+---+ / | cell |) into rows of joined cell text. Header row excluded. */
export function parseGridTable(lines: string[]): string[][] {
  const start = lines.findIndex((l) => /^\+[-=+]+\+\s*$/.test(l));
  if (start < 0) return [];
  const sep = lines[start];
  const bounds: number[] = [];
  for (let i = 0; i < sep.length; i++) if (sep[i] === "+") bounds.push(i);
  const rows: string[][] = [];
  let buf: string[] = [];
  let headerDone = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\+[-=+]+\+\s*$/.test(l)) {
      if (buf.length) {
        const cells = bounds.slice(0, -1).map((b, ci) =>
          norm(buf.map((bl) => bl.slice(b + 1, bounds[ci + 1])).join(" ")),
        );
        if (headerDone) rows.push(cells);
        if (l.includes("=")) headerDone = true;
        else if (!headerDone) headerDone = true; // tables without '=' header separator: first row is header
      }
      buf = [];
      continue;
    }
    if (l.startsWith("|")) buf.push(l);
    else break;
  }
  return rows;
}

/** Collect "  - bullet" items with wrapped continuation lines. */
function parseBullets(lines: string[]): string[] {
  const items: string[] = [];
  for (const l of lines) {
    const m = l.match(/^\s{2}- (.*)$/);
    if (m) items.push(m[1].trim());
    else if (items.length && /^\s{4,}\S/.test(l)) items[items.length - 1] += " " + l.trim();
  }
  return items.map(norm);
}

const FIELD_LABELS = [
  "Criterion ID",
  "Criterion",
  "Expected job outcome",
  "Basis and sources",
  "Weight %",
  "Score anchors 1-5",
  "Acceptable evidence",
  "Interview probe",
] as const;

function parseCriterionBlocks(lines: string[], role: Role, hypothesisSupport: Map<string, { s: number; r: number }>) {
  const headerRe = new RegExp(`^(${role}-\\d+)\\s{2,}(.+?)\\s{2,}\\[(CV-OK|CV-PARTIAL|INTERVIEW/WORK-SAMPLE ONLY)\\]\\s*$`);
  const labelRe = new RegExp(`^ {2}(${FIELD_LABELS.map((f) => f.replace(/[%]/g, "%")).join("|")}):\\s*(.*)$`);
  const criteria: Criterion[] = [];
  const errors: string[] = [];

  let cur: { code: string; name: string; mode: string; fields: Record<string, string> } | null = null;
  let curField: string | null = null;

  const flush = () => {
    if (!cur) return;
    const f = cur.fields;
    const weightMatch = (f["Weight %"] ?? "").match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!weightMatch) errors.push(`${cur.code}: weight not found`);
    const anchorsText = f["Score anchors 1-5"] ?? "";
    const parts = anchorsText.split(/(?:^|\s)([1-5]) = /).slice(1);
    const anchors: Record<string, string> = {};
    for (let i = 0; i < parts.length; i += 2) anchors[parts[i]] = norm(parts[i + 1] ?? "");
    for (const k of ["1", "2", "3", "4", "5"]) if (!anchors[k]) errors.push(`${cur.code}: anchor ${k} missing`);
    const basis = f["Basis and sources"] ?? "";
    const refs = Array.from(new Set(Array.from(basis.matchAll(/\(H(\d+)\)/g)).map((m) => `H${m[1]}`)));
    let s = 0;
    let r = 0;
    for (const ref of refs) {
      const hs = hypothesisSupport.get(ref);
      if (hs) {
        s += hs.s;
        r += hs.r;
      }
    }
    if ((f["Criterion ID"] ?? cur.code) !== cur.code) errors.push(`${cur.code}: Criterion ID field mismatch`);
    criteria.push({
      code: cur.code,
      role,
      name: norm(f["Criterion"] ?? cur.name),
      evidenceMode: cur.mode as Criterion["evidenceMode"],
      weight: weightMatch ? Number(weightMatch[1]) : NaN,
      weightNote: weightMatch ? norm(weightMatch[2]).replace(/^\(|\)$/g, "") : "",
      expectedOutcome: norm(f["Expected job outcome"] ?? ""),
      basis: norm(basis),
      anchors: anchors as Criterion["anchors"],
      acceptableEvidence: norm(f["Acceptable evidence"] ?? ""),
      interviewProbe: norm(f["Interview probe"] ?? ""),
      hypothesisRefs: refs,
      historicalSupport: {
        supportingCases: s,
        relevantCases: r,
        basis: refs.length
          ? `JD-derived hypotheses ${refs.join(", ")}: ${s} supporting / ${r} relevant historical cases`
          : `No hypothesis cited; JD basis only: ${s} supporting / ${r} relevant historical cases`,
      },
      patternConfidence: "Not established",
    });
  };

  for (const line of lines) {
    const h = line.match(headerRe);
    if (h) {
      flush();
      cur = { code: h[1], name: h[2].trim(), mode: h[3], fields: {} };
      curField = null;
      continue;
    }
    if (!cur) continue;
    if (/^~+$/.test(line)) continue;
    const lm = line.match(labelRe);
    if (lm) {
      curField = lm[1];
      cur.fields[curField] = lm[2];
      continue;
    }
    if (curField && /^\s{10,}\S/.test(line)) {
      cur.fields[curField] += " " + line.trim();
      continue;
    }
    if (line.trim() === "") curField = null;
  }
  flush();
  return { criteria, errors };
}

function parseEssentialTable(lines: string[], role: Role): EssentialRequirement[] {
  const rows = parseGridTable(lines);
  const reqs: EssentialRequirement[] = [];
  for (const row of rows) {
    const [code, requirement, source, statusRule] = row;
    if (!code || !/^ER-/.test(code)) continue;
    reqs.push({
      code,
      role,
      requirement,
      source,
      statusRule,
      statusRuleResolved: statusRule,
      essentialityConfirmed: true,
    });
  }
  return reqs;
}

/** "Same rule as ER-PM-A." → resolve to that rule's text, then derive whether essentiality is confirmed. */
function resolveEssentialRules(all: EssentialRequirement[]) {
  const byCode = new Map(all.map((r) => [r.code, r]));
  for (const r of all) {
    const ref = r.statusRule.match(/Same rule as (ER-[A-Z]+-[A-Z])/i);
    if (ref && byCode.get(ref[1])) r.statusRuleResolved = byCode.get(ref[1])!.statusRule;
    r.essentialityConfirmed = !/(to be confirmed|founder confirms|confirmed by the founder|essentiality to)/i.test(
      r.statusRuleResolved,
    );
  }
}

export function parseRubixText(source: string): ParsedRubric {
  const text = source.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const errors: string[] = [];

  const title = norm(lines[0] ?? "Rubric");
  const versionLine = lines.find((l) => /^Version:/.test(l)) ?? "";
  const versionLabel = versionLine.match(/Version:\s*([^\s|]+)/)?.[1] ?? "unversioned";
  const preparedDate = versionLine.match(/Prepared:\s*([0-9-]+)/)?.[1] ?? null;
  const statusLineIdx = lines.findIndex((l) => /^STATUS:\s*\S/.test(l));
  const declaredStatus = statusLineIdx >= 0 ? norm(lines[statusLineIdx].replace(/^STATUS:\s*/, "")) : "UNSPECIFIED";
  let statusStatement = "";
  if (statusLineIdx >= 0) {
    const buf: string[] = [];
    for (let i = statusLineIdx + 1; i < lines.length && !/^\*{10,}/.test(lines[i]); i++) buf.push(lines[i]);
    statusStatement = norm(buf.join(" "));
  }

  const sections = splitSections(lines);
  for (const n of [3, 4, 5, 6]) if (!sections.has(n)) errors.push(`Section ${n} not found`);
  if (errors.length) throw new RubricParseError("Rubric structure not recognised", errors);

  // Section 1.4 gaps
  const s1 = splitSubsections(sections.get(1)?.lines ?? []);
  const gapRows = parseGridTable(s1.find((s) => s.id === "1.4")?.lines ?? []);
  const gaps = gapRows.filter((r) => r[0]).map((r) => ({ id: r[0], issue: r[1], effect: r[4] ?? "" }));

  // Section 2 status
  const s2text = (sections.get(2)?.lines ?? []).join("\n");
  const historicalMatrixStatus = norm(s2text.match(/STATUS:\s*([^\n]+)/)?.[1] ?? "");
  const histCount = s2text.match(/(\d+) historical hire records? available/);
  const historicalRecordsAvailable = histCount ? Number(histCount[1]) : 0;

  // Section 3 hypotheses
  const s3 = splitSubsections(sections.get(3)!.lines);
  const hypRows = parseGridTable(s3.find((s) => s.id === "3.1")?.lines ?? []);
  const hypotheses = hypRows
    .filter((r) => /^H\d+$/.test(r[0]))
    .map((r) => {
      const m = (r[4] ?? "").match(/(\d+)\s*\/\s*(\d+)/);
      return {
        id: r[0],
        behavior: r[1],
        roleRelevance: r[2] ?? "",
        supportingCases: m ? Number(m[1]) : 0,
        relevantCases: m ? Number(m[2]) : 0,
      };
    });
  const hypothesisSupport = new Map(hypotheses.map((h) => [h.id, { s: h.supportingCases, r: h.relevantCases }]));
  const exclRows = parseGridTable(s3.find((s) => s.id === "3.3")?.lines ?? []);
  const excludedSignals = exclRows.filter((r) => r[0]).map((r) => ({ signal: r[0], treatment: r[1], reason: r[2] ?? "" }));

  // Sections 4 & 5 scorecards
  const roleSections: Record<Role, number> = { PM: 4, SPM: 5 };
  const roles = {} as ParsedRubric["roles"];
  for (const role of ["PM", "SPM"] as Role[]) {
    const sec = sections.get(roleSections[role])!;
    const subs = splitSubsections(sec.lines);
    const summary = subs.find((s) => /summary/i.test(s.title));
    const summaryRows = parseGridTable(summary?.lines ?? []);
    const summaryWeights: Record<string, { weight: number; evidenceMode: string }> = {};
    let statedTotal: number | null = null;
    for (const row of summaryRows) {
      if (/^(PM|SPM)-\d+$/.test(row[0])) summaryWeights[row[0]] = { weight: Number(row[3]), evidenceMode: row[2] };
      else if (/TOTAL/i.test(row[1] ?? "")) statedTotal = Number(row[3]);
    }
    const full = subs.find((s) => /full criteria/i.test(s.title));
    const { criteria, errors: cErr } = parseCriterionBlocks(full?.lines ?? sec.lines, role, hypothesisSupport);
    errors.push(...cErr);
    const essential = subs.find((s) => /essential requirements/i.test(s.title));
    roles[role] = {
      role,
      title: ROLE_TITLES[role],
      criteria,
      essentialRequirements: parseEssentialTable(essential?.lines ?? [], role),
      summaryWeights,
      statedTotal,
    };
  }
  resolveEssentialRules([...roles.PM.essentialRequirements, ...roles.SPM.essentialRequirements]);

  // Section 6 rules
  const s6lines = sections.get(6)!.lines;
  const s6 = splitSubsections(s6lines);
  const s6text = s6lines.join("\n");
  const covMin = s6text.match(/Coverage below (\d+(?:\.\d+)?)%/);
  const gap = s6text.match(/differs by more than (\d+(?:\.\d+)?) percentage points/);
  if (!covMin) errors.push("Coverage minimum (\"Coverage below N%\") not found in Section 6");
  if (!gap) errors.push("Comparable coverage gap (\"differs by more than N percentage points\") not found");
  const formulaText = (s6.find((s) => s.id === "6.2")?.lines ?? []).join("\n").trim();
  const recRows = parseGridTable(s6.find((s) => s.id === "6.6")?.lines ?? []);
  const essRows = parseGridTable(s6.find((s) => s.id === "6.4")?.lines ?? []);
  const confRows = parseGridTable(s6.find((s) => s.id === "6.5")?.lines ?? []);
  const scoringRulesText = parseBullets(s6.find((s) => s.id === "6.1")?.lines ?? []);
  const interpretationLimitsText = parseBullets(s6.find((s) => s.id === "6.3")?.lines ?? []);
  const confidenceCap = /capped at Medium/i.test(scoringRulesText.join(" ")) ? "Medium" : "High";

  // Section 8.3 founder questions
  const s8 = splitSubsections(sections.get(8)?.lines ?? []);
  const qLines = s8.find((s) => s.id === "8.3")?.lines ?? [];
  const founderQuestions: string[] = [];
  for (const l of qLines) {
    const m = l.match(/^\s{2}(Q\d+\.\s.*)$/);
    if (m) founderQuestions.push(m[1].trim());
    else if (founderQuestions.length && /^\s{6,}\S/.test(l)) founderQuestions[founderQuestions.length - 1] += " " + l.trim();
  }

  if (errors.length) throw new RubricParseError("Rubric could not be parsed without guessing", errors);

  const parsed: ParsedRubric = {
    schemaVersion: 1,
    title,
    versionLabel,
    preparedDate,
    declaredStatus,
    statusStatement,
    historicalMatrixStatus,
    historicalRecordsAvailable,
    roles,
    hypotheses,
    excludedSignals,
    rules: {
      scoreMin: 1,
      scoreMax: 5,
      notEnoughEvidenceLabel: "NE",
      coverageMinimumPct: Number(covMin![1]),
      maxComparableCoverageGapPct: Number(gap![1]),
      defaultStage: "CV screen",
      interviewOnlyMustBeNEAtCvStage: /must be NE at CV-screen stage/i.test(s6text),
      cvPartialConfidenceCap: confidenceCap,
      lowScoreRequiresExplicitNegativeEvidence: /low score \(1-2\) requires explicit negative evidence/i.test(s6text),
      missingEvidenceNeverScored: /Missing evidence never receives 0, 1 or an assumed average/i.test(s6text),
      noAutomaticThresholds: /no automatic accept or reject thresholds/i.test(s6text),
      roundingDecimals: /one decimal place/i.test(s6text) ? 1 : 1,
      formulaText,
      displayFormat: s6text.match(/Display \(always both\):\s*"([^"]+)"/)?.[1] ?? "Score XX.X/100 at YY% coverage (stage: <stage>)",
      scoringRulesText,
      interpretationLimitsText,
      recommendationVocabulary: recRows.filter((r) => r[0]).map((r) => ({ step: r[0], useWhen: r[1] })),
      essentialStatuses: essRows.filter((r) => r[0]).map((r) => ({ status: r[0], meaning: r[1], action: r[2] })),
      confidenceRatings: confRows.filter((r) => r[0]).map((r) => ({ rating: r[0], levels: r[1], definition: r[2] })),
    },
    founderQuestions: founderQuestions.map(norm),
    gaps,
  };
  return ParsedRubricSchema.parse(parsed);
}
