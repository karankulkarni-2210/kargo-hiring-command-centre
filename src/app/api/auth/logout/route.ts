import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const sb = await createSupabaseServer();
  await sb.auth.signOut();
  return Response.redirect(new URL("/login", req.url), 303);
}
