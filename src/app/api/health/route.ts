export const dynamic = "force-dynamic";

/** Public liveness probe. Reports only whether integrations are configured, never their values. */
export async function GET() {
  return Response.json({
    ok: true,
    app: "kargo-hiring-command-centre",
    supabaseConfigured: Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
  });
}
