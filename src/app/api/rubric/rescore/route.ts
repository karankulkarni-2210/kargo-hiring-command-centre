import { HttpError, withFounder } from "@/lib/auth";
import { enqueue } from "@/lib/pipeline/jobs";
import { loadActiveRubric } from "@/lib/rubric/store";

export const runtime = "nodejs";

/** Founder-triggered: re-score every extracted candidate against the ACTIVE rubric (both roles). */
export async function POST() {
  return withFounder(async ({ supabase, email }) => {
    const active = await loadActiveRubric(supabase);
    if (!active) throw new HttpError(400, "No active rubric");
    const { data: profs } = await supabase.from("candidate_profiles").select("candidate_id");
    let n = 0;
    for (const p of profs ?? []) {
      const { data: evs } = await supabase.from("evaluations").select("role").eq("candidate_id", p.candidate_id).eq("is_current", true).eq("rubric_version_id", active.id);
      const have = new Set((evs ?? []).map((e) => e.role));
      for (const role of ["PM", "SPM"] as const)
        if (!have.has(role)) {
          await enqueue(supabase, "score", p.candidate_id, role, `score:${p.candidate_id}:${role}`);
          n++;
        }
    }
    await supabase.from("audit_log").insert({ actor: email, action: "rescore_requested", entity: "rubric_version", entity_id: active.id, details: { jobs: n } });
    return { queued: n };
  });
}
