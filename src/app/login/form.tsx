"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { buttonClass } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { error: null });
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-muted">Founder email</span>
        <input name="email" type="email" autoComplete="email" required className="focus-ring mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-faint" placeholder="you@company.com" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="focus-ring mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-text" />
      </label>
      {state.error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button disabled={pending} className={buttonClass("primary") + " w-full py-2.5"}>
        {pending ? "Verifying…" : "Sign in"}
      </button>
    </form>
  );
}
