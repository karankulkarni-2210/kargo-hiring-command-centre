import { HttpError, withFounder } from "@/lib/auth";
import { enqueue } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

/** Re-queue a failed candidate from the right step (extraction or scoring). */
export async function POST(_req: Request, ctx: RouteContext<"/api/candidates/[id]/retry">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    const { data: cand } = await supabase.from("candidates").select("id, status, applied_role").eq("id", id).maybeSingle();
    if (!cand) throw new HttpError(404, "Candidate not found");
    if (cand.status === "duplicate") throw new HttpError(400, "Duplicates are not processed.");
    await supabase.from("jobs").update({ status: "cancelled" }).eq("candidate_id", id).eq("status", "failed");
    const { data: prof } = await supabase.from("candidate_profiles").select("candidate_id").eq("candidate_id", id).maybeSingle();
    if (!prof) {
      await supabase.from("candidates").update({ status: "queued", last_error: null }).eq("id", id);
      await enqueue(supabase, "extract", id, null, `extract:${id}`);
    } else {
      await supabase.from("candidates").update({ status: "extracted", last_error: null }).eq("id", id);
      await enqueue(supabase, "score", id, "PM", `score:${id}:PM`);
      await enqueue(supabase, "score", id, "SPM", `score:${id}:SPM`);
    }
    await supabase.from("audit_log").insert({ actor: email, action: "retry", entity: "candidate", entity_id: id });
    return { ok: true, from: prof ? "score" : "extract" };
  });
}
