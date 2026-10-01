import { withFounder } from "@/lib/auth";
import { queueCounts } from "@/lib/pipeline/jobs";

export const runtime = "nodejs";

export async function GET() {
  return withFounder(async ({ supabase }) => ({ queue: await queueCounts(supabase), geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()) }));
}
