"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "./ui";

/** Re-runs automatic role fit for all scored candidates (founder-set / decided ones keep their role). */
export function ReassignRolesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button
        className={buttonClass("ghost")}
        disabled={busy}
        title="Recalculate which role each scored CV fits. Roles you set yourself, and candidates with a recorded decision, are kept."
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const r = await fetch("/api/candidates/reassign-roles", { method: "POST" });
          const b = await r.json().catch(() => ({}));
          setMsg(r.ok ? `${b.changed} of ${b.checked} moved` : (b.error ?? "Failed"));
          if (r.ok) window.dispatchEvent(new Event("kargo:process"));
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "Checking…" : "Re-check role fit"}
      </button>
    </span>
  );
}
