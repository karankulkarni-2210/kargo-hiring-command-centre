import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({ decision: z.enum(["advance", "hold", "decline"]), rationale: z.string().trim().min(10).max(4000) });

/**
 * Records the founder's decision. Stored separately from the AI recommendation (which is
 * snapshotted for audit). Recording a decision NEVER sends an email.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/candidates/[id]/decision">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Choose Advance, Hold or Decline and give a rationale (at least 10 characters).");
    const { data: cand } = await supabase.from("candidates").select("id, applied_role, applied_rank, in_top5").eq("id", id).maybeSingle();
    if (!cand) throw new HttpError(404, "Candidate not found");
    const { data: ev } = await supabase
      .from("evaluations")
      .select("id, score, coverage_pct, recommendation, rubric_version_id, recommendation_reasons")
      .eq("candidate_id", id)
      .eq("role", cand.applied_role)
      .eq("is_current", true)
      .maybeSingle();
    const { data, error } = await supabase
      .from("decisions")
      .insert({
        candidate_id: id,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        decided_by_email: email,
        ai_recommendation_snapshot: ev
          ? { evaluation_id: ev.id, score: ev.score, coverage_pct: ev.coverage_pct, recommendation: ev.recommendation, rank: cand.applied_rank, in_top5: cand.in_top5, display: (ev.recommendation_reasons as { display?: string })?.display }
          : { note: "No evaluation existed at decision time" },
        rubric_version_id: ev?.rubric_version_id ?? null,
      })
      .select()
      .single();
    if (error) throw new HttpError(500, error.message);
    await supabase.from("audit_log").insert({ actor: email, action: "decision_recorded", entity: "candidate", entity_id: id, details: { decision: parsed.data.decision } });
    return { decision: data };
  });
}
