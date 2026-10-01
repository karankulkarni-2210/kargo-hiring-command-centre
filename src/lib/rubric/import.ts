import { parseRubixText, RubricParseError } from "./parse-rubix";
import { ParsedRubricSchema, type ParsedRubric } from "./types";
import { normaliseForMatch } from "../scoring/engine";

export type ParseOutcome = { parsed: ParsedRubric; method: "rubix_text" | "json" };

/** Deterministic import: the Rubix text format, or a JSON file matching ParsedRubricSchema. */
export function parseRubricSource(text: string, filename: string): ParseOutcome {
  const t = text.replace(/^﻿/, "");
  if (/\.json$/i.test(filename) || t.trim().startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch (e) {
      throw new RubricParseError("JSON rubric is not valid JSON", [(e as Error).message]);
    }
    const r = ParsedRubricSchema.safeParse(data);
    if (!r.success) throw new RubricParseError("JSON rubric does not match the rubric schema", r.error.issues.slice(0, 12).map((i) => `${i.path.join(".")}: ${i.message}`));
    return { parsed: r.data, method: "json" };
  }
  return { parsed: parseRubixText(t), method: "rubix_text" };
}

/**
 * Checks that every criterion name, weight, anchor and essential requirement in a structured
 * rubric appears in the original source. Used to prove an AI-assisted or JSON import did not
 * rewrite or invent criteria.
 */
export function verifyAgainstSource(parsed: ParsedRubric, source: string): string[] {
  const hay = normaliseForMatch(source);
  const failures: string[] = [];
  const has = (s: string) => hay.includes(normaliseForMatch(s));
  for (const role of ["PM", "SPM"] as const) {
    for (const c of parsed.roles[role].criteria) {
      if (!has(c.code)) failures.push(`${c.code}: code not found in source`);
      if (!has(c.name)) failures.push(`${c.code}: name "${c.name}" not found verbatim in source`);
      if (!new RegExp(`(^|[^0-9.])${String(c.weight).replace(".", "\\.")}([^0-9]|$)`).test(source)) failures.push(`${c.code}: weight ${c.weight} not found in source`);
      for (const k of ["1", "2", "3", "4", "5"] as const) {
        const a = c.anchors[k].slice(0, 48);
        if (!has(a)) failures.push(`${c.code}: anchor ${k} not found verbatim in source`);
      }
      const n = c.historicalSupport.supportingCases;
      if (n > 0 && !new RegExp(`\\b${n}\\s+(supporting|of\\s+\\d+\\s+hires?|hires?\\s+support)`, "i").test(source))
        failures.push(`${c.code}: claims ${n} supporting hire(s), which the source does not state`);
    }
    for (const e of parsed.roles[role].essentialRequirements) if (!has(e.code) || !has(e.requirement.split(/\s+/).slice(0, 3).join(" "))) failures.push(`${e.code}: requirement not found in source`);
  }
  return failures;
}
