import { HttpError, withFounder } from "@/lib/auth";
import { enqueue } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

/** Step 2 of upload: confirm the object exists in private storage, then queue extraction. */
export async function POST(_req: Request, ctx: RouteContext<"/api/uploads/[id]/complete">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    const { data: cand } = await supabase.from("candidates").select("id, file_path, status").eq("id", id).maybeSingle();
    if (!cand) throw new HttpError(404, "Candidate not found");
    if (!cand.file_path) throw new HttpError(400, "No file path");
    const [folder, file] = cand.file_path.split("/");
    const { data: listed, error } = await supabase.storage.from("cvs").list(folder, { search: file });
    if (error) throw new HttpError(502, `Storage check failed: ${error.message}`);
    if (!listed?.some((o) => o.name === file)) throw new HttpError(409, "Upload not found in storage — retry the upload.");
    if (cand.status === "awaiting_upload" || cand.status === "failed" || cand.status === "needs_attention") {
      await supabase.from("candidates").update({ status: "queued", last_error: null }).eq("id", id);
    }
    await enqueue(supabase, "extract", id, null, `extract:${id}`);
    await supabase.from("audit_log").insert({ actor: email, action: "upload_completed", entity: "candidate", entity_id: id });
    return { ok: true };
  });
}
