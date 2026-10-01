import "server-only";

/** Server-side configuration. Secrets are read here and never sent to the browser. */
export function supabaseUrl(): string {
  const v = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("SUPABASE_URL is not configured");
  return v.trim();
}
export function supabaseAnonKey(): string {
  const v = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error("SUPABASE_ANON_KEY is not configured");
  return v.trim();
}
export function supabaseConfigured(): boolean {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
}
export function serviceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
