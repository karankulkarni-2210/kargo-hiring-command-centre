import { z } from "zod";
import { HttpError, withFounder } from "@/lib/auth";
import { validateTemplate } from "@/lib/email/core";

export const runtime = "nodejs";

const Body = z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(20).max(6000), expectedVersion: z.number().int() });

/** Save a founder edit as a new draft version. Placeholders stay in the template. */
export async function PUT(req: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Subject and body are required.");
    const { data: d } = await supabase.from("email_drafts").select("*").eq("id", id).eq("is_current", true).maybeSingle();
    if (!d) throw new HttpError(404, "Draft not found or superseded — reload.");
    if (d.version !== parsed.data.expectedVersion) throw new HttpError(409, "This draft changed since you opened it — reload.");
    const problems = validateTemplate(parsed.data.subject, parsed.data.body);
    if (problems.length) throw new HttpError(422, problems.join(" "), { problems });
    await supabase.from("email_drafts").update({ is_current: false }).eq("id", id);
    const { data, error } = await supabase
      .from("email_drafts")
      .insert({
        candidate_id: d.candidate_id,
        kind: d.kind,
        subject_template: parsed.data.subject,
        body_template: parsed.data.body,
        version: d.version + 1,
        origin: "founder_edited",
        model: d.model,
        suggested_by_rank: d.suggested_by_rank,
        is_current: true,
      })
      .select()
      .single();
    if (error) throw new HttpError(500, error.message);
    await supabase.from("audit_log").insert({ actor: email, action: "draft_edited", entity: "email_draft", entity_id: data.id });
    return { draft: data };
  });
}
