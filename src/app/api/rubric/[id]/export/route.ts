import { HttpError, withFounder } from "@/lib/auth";

export const runtime = "nodejs";

/** Download the parsed rubric as JSON — edit it and re-import to replace the rubric. */
export async function GET(_req: Request, ctx: RouteContext<"/api/rubric/[id]/export">) {
  const { id } = await ctx.params;
  return withFounder(async ({ supabase }) => {
    const { data } = await supabase.from("rubric_versions").select("parsed, version_label").eq("id", id).maybeSingle();
    if (!data) throw new HttpError(404, "Rubric not found");
    return new Response(JSON.stringify(data.parsed, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="rubric-v${data.version_label}.json"` },
    });
  });
}
