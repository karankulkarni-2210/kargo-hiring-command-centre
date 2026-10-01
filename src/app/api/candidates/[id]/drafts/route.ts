import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { enqueue } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

const Body = z.object({ kind: z.enum(["invite", "rejection"]) });

/** Founder asks for a (re)generated draft of a given type. Queued; never sent. */
export async function POST(req: Request, ctx: RouteContext<"/api/candidates/[id]/drafts">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "kind must be invite or rejection");
    const { data: cand } = await supabase.from("candidates").select("applied_role").eq("id", id).maybeSingle();
    if (!cand) throw new HttpError(404, "Candidate not found");
    if (!cand.applied_role) throw new HttpError(409, "Assign this candidate to PM or SPM first.");
    await enqueue(supabase, "draft", id, cand.applied_role, `draft:${id}:${parsed.data.kind}`, { kind: parsed.data.kind, regenerate: true });
    return { queued: true };
  });
}
