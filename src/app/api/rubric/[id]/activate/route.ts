import { HttpError, withFounder } from "@/lib/auth";
import { activateRubric } from "@/lib/rubric/store";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: RouteContext<"/api/rubric/[id]/activate">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase, email }) => {
    try {
      await activateRubric(supabase, id);
    } catch (e) {
      throw new HttpError(422, (e as Error).message);
    }
    await supabase.from("audit_log").insert({ actor: email, action: "rubric_activated", entity: "rubric_version", entity_id: id });
    return { ok: true };
  });
}
