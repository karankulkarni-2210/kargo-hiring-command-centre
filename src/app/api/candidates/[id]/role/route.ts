import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { loadActiveRubric } from "@/lib/rubric/store";
import { assignRole } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

const Body = z.object({ role: z.enum(["PM", "SPM", "auto"]) });

/**
 * Founder override of the automatic role fit ("PM" / "SPM"), or hand it back to automatic ("auto").
 * Re-ranks both roles. Never decides or contacts anyone. Blocked once a decision has been recorded.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/candidates/[id]/role">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "role must be PM, SPM or auto");
    const { data: cand } = await supabase.from("candidates").select("id, status").eq("id", id).maybeSingle();
    if (!cand) throw new HttpError(404, "Candidate not found");
    if (cand.status !== "scored") throw new HttpError(409, "The CV must be scored against both rubrics first.");
    const rubric = await loadActiveRubric(supabase);
    if (!rubric) throw new HttpError(409, "No active rubric.");
    const out = await assignRole(supabase, id, rubric, { actor: email, override: parsed.data.role });
    if (out.locked) throw new HttpError(409, "A decision has already been recorded for this candidate in its current role, so the role is fixed.");
    return { role: out.role, source: out.source, changed: out.changed, fit: out.fit };
  });
}
