import { withFounder } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter((s) => /^[0-9a-f-]{36}$/.test(s)).slice(0, 100);
  return withFounder(async ({ supabase }) => {
    if (!ids.length) return { candidates: [] };
    const { data } = await supabase.from("candidates").select("id, status, last_error, applied_rank, in_top5, duplicate_of").in("id", ids);
    return { candidates: data ?? [] };
  });
}
