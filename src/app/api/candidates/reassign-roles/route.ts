import { HttpError, withFounder } from "@/lib/auth";
import { loadActiveRubric } from "@/lib/rubric/store";
import { assignRole } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

/**
 * Re-run automatic role fit for every scored candidate. Founder-set and decided candidates keep
 * their role (their fit is still refreshed for display). Never decides or contacts anyone.
 */
export async function POST() {
  return withFounder(async ({ supabase, email }) => {
    const rubric = await loadActiveRubric(supabase);
    if (!rubric) throw new HttpError(409, "No active rubric.");
    const { data: cands, error } = await supabase.from("candidates").select("id").eq("status", "scored");
    if (error) throw new HttpError(500, error.message);
    const results = [];
    for (const c of cands ?? []) {
      const r = await assignRole(supabase, c.id, rubric, { actor: email });
      results.push({ id: c.id, from: r.previous, to: r.role, changed: r.changed, locked: r.locked, source: r.source, basis: r.fit.basis });
    }
    return { checked: results.length, changed: results.filter((r) => r.changed).length, results };
  });
}
