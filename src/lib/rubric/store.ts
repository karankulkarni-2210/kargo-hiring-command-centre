import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedRubric, RubricValidation } from "./types";
import { ParsedRubricSchema } from "./types";

export type ActiveRubric = { id: string; versionLabel: string; parsed: ParsedRubric; validation: RubricValidation; declaredStatus: string };

export function sha256Hex(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function loadActiveRubric(sb: SupabaseClient): Promise<ActiveRubric | null> {
  const { data, error } = await sb
    .from("rubric_versions")
    .select("id, version_label, parsed, validation, declared_status")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Could not load rubric: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    versionLabel: data.version_label,
    parsed: ParsedRubricSchema.parse(data.parsed),
    validation: data.validation as RubricValidation,
    declaredStatus: data.declared_status,
  };
}

export function buildRubricRows(p: {
  parsed: ParsedRubric;
  validation: RubricValidation;
  sourceText: string;
  sourceFilename: string;
  parseMethod: "rubix_text" | "json" | "ai_assisted";
  importedBy: string;
  id?: string;
}) {
  const id = p.id ?? crypto.randomUUID();
  const version = {
    id,
    version_label: p.parsed.versionLabel,
    source_filename: p.sourceFilename,
    source_text: p.sourceText,
    source_sha256: sha256Hex(p.sourceText),
    parse_method: p.parseMethod,
    declared_status: p.parsed.declaredStatus,
    parsed: p.parsed,
    validation: p.validation,
    is_active: false,
    imported_by: p.importedBy,
  };
  const criteria = (["PM", "SPM"] as const).flatMap((role) =>
    p.parsed.roles[role].criteria.map((c, i) => ({
      rubric_version_id: id,
      role,
      criterion_code: c.code,
      name: c.name,
      weight: c.weight,
      evidence_mode: c.evidenceMode,
      expected_outcome: c.expectedOutcome,
      basis: c.basis,
      anchors: c.anchors,
      acceptable_evidence: c.acceptableEvidence,
      interview_probe: c.interviewProbe,
      hypothesis_refs: c.hypothesisRefs,
      historical_supporting_cases: c.historicalSupport.supportingCases,
      historical_relevant_cases: c.historicalSupport.relevantCases,
      pattern_confidence: c.patternConfidence,
      sort_order: i + 1,
    })),
  );
  const essentials = (["PM", "SPM"] as const).flatMap((role) =>
    p.parsed.roles[role].essentialRequirements.map((e, i) => ({
      rubric_version_id: id,
      role,
      code: e.code,
      requirement: e.requirement,
      source: e.source,
      status_rule: e.statusRuleResolved,
      essentiality_confirmed: e.essentialityConfirmed,
      sort_order: i + 1,
    })),
  );
  return { version, criteria, essentials };
}

export async function insertRubric(sb: SupabaseClient, rows: ReturnType<typeof buildRubricRows>) {
  const { error: e1 } = await sb.from("rubric_versions").insert(rows.version);
  if (e1) throw new Error(e1.code === "23505" ? "This exact rubric file has already been imported." : e1.message);
  const { error: e2 } = await sb.from("rubric_criteria").insert(rows.criteria);
  if (e2) throw new Error(`criteria: ${e2.message}`);
  if (rows.essentials.length) {
    const { error: e3 } = await sb.from("rubric_essential_requirements").insert(rows.essentials);
    if (e3) throw new Error(`essential requirements: ${e3.message}`);
  }
  return rows.version.id;
}

export async function activateRubric(sb: SupabaseClient, id: string) {
  const { data: target, error } = await sb.from("rubric_versions").select("id, validation").eq("id", id).single();
  if (error || !target) throw new Error("Rubric version not found");
  if (!(target.validation as RubricValidation).ok) throw new Error("This rubric has validation errors (e.g. weights do not total 100%) and cannot be activated.");
  const { error: e1 } = await sb.from("rubric_versions").update({ is_active: false }).eq("is_active", true);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await sb.from("rubric_versions").update({ is_active: true, activated_at: new Date().toISOString() }).eq("id", id);
  if (e2) throw new Error(e2.message);
}
