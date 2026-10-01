import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "../env";

/** Request-scoped client acting as the signed-in founder. All queries are subject to RLS. */
export async function createSupabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component; the proxy refreshes the session instead */
        }
      },
    },
  });
}

/**
 * Privileged client for the cron fallback worker only. Bypasses RLS, so it is never used
 * in a request that a browser can reach without CRON_SECRET.
 */
export function createServiceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createPlainClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
