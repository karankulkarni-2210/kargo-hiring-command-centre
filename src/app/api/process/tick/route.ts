import { withFounder } from "@/lib/auth";
import { queueCounts, runTick } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One bounded processing tick, run as the signed-in founder (RLS applies). The browser calls
 * this repeatedly while work is queued, so 60 CVs are processed as many short requests rather
 * than one long one. Interrupted jobs are re-claimed after 5 minutes (claim_jobs).
 */
export async function POST() {
  return withFounder(async ({ supabase, email }) => {
    const tick = await runTick(supabase, `browser:${email}`);
    const queue = await queueCounts(supabase);
    return { ...tick, queue };
  });
}
