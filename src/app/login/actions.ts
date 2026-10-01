"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function signIn(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const sb = await createSupabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "Sign-in failed. Check your credentials." };
  const { data: ok } = await sb.rpc("is_founder");
  if (!ok) {
    await sb.auth.signOut();
    return { error: "This account is not on the founder allowlist." };
  }
  redirect("/");
}
