import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServer } from "./supabase/server";
import { supabaseConfigured } from "./env";

export type FounderContext = { supabase: SupabaseClient; user: User; email: string };

export class AuthError extends Error {
  constructor(public status: 401 | 403 | 503, message: string) {
    super(message);
  }
}

/** Verifies the session with Supabase Auth (not just the cookie) and checks the founder allowlist. */
export async function getFounder(): Promise<FounderContext> {
  if (!supabaseConfigured()) throw new AuthError(503, "Supabase is not configured");
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthError(401, "Sign in required");
  const { data: ok, error: rpcErr } = await supabase.rpc("is_founder");
  if (rpcErr) throw new AuthError(503, `Could not verify founder access: ${rpcErr.message}`);
  if (!ok) throw new AuthError(403, "This account is not on the founder allowlist");
  return { supabase, user: data.user, email: (data.user.email ?? "").toLowerCase() };
}

/** For Server Components: redirect to /login instead of throwing. */
export async function requireFounderPage(): Promise<FounderContext> {
  try {
    return await getFounder();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect("/login?error=not_founder");
    if (e instanceof AuthError && e.status === 503) redirect("/login?error=not_configured");
    redirect("/login");
  }
}

/** For Route Handlers. */
export async function withFounder<T>(fn: (ctx: FounderContext) => Promise<T>): Promise<Response> {
  try {
    const ctx = await getFounder();
    const out = await fn(ctx);
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof HttpError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
    console.error(e);
    return Response.json({ error: (e as Error).message ?? "Server error" }, { status: 500 });
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
