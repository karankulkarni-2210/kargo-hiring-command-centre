import { createServiceClient } from "@/lib/supabase/server";
import { queueCounts, runTick } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fallback worker for Vercel Cron, so queued work still drains when no browser is open.
 * Requires CRON_SECRET (sent by Vercel as a Bearer token) and SUPABASE_SERVICE_ROLE_KEY.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured; cron worker disabled" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorised" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured; cron worker disabled" }, { status: 503 });
  const sb = createServiceClient();
  const tick = await runTick(sb, "cron", { startNewBeforeMs: 40_000 });
  return Response.json({ ...tick, queue: await queueCounts(sb) });
}
