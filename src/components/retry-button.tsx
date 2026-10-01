"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "./ui";

export function RetryButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={buttonClass("outline")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await fetch(`/api/candidates/${candidateId}/retry`, { method: "POST" });
          if (!r.ok) setErr((await r.json()).error);
          else window.dispatchEvent(new Event("kargo:process"));
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "Re-queuing…" : "Retry processing"}
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
