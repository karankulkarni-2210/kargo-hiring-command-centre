"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

export function GeminiCheck({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={buttonClass("outline")}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/settings/gemini-check", { method: "POST" });
          const b = await r.json();
          setBusy(false);
          setRes(r.ok ? `OK — ${b.model} returned valid structured JSON in ${b.ms} ms` : `Failed (${b.model}): ${b.error}`);
        }}
      >
        {busy ? "Checking…" : "Run Gemini check"}
      </button>
      <span className="text-xs text-muted">Sends one synthetic prompt (no candidate data).</span>
      {res && <span className={`text-xs ${res.startsWith("OK") ? "text-ok" : "text-danger"}`}>{res}</span>}
    </div>
  );
}

export function TestEmail({ enabled, destination }: { enabled: boolean; destination: string | null }) {
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
      <div className="text-xs font-medium">Resend integration test</div>
      <p className="text-xs text-muted">Sends a fixed message (no candidate data) to the MESA test inbox.</p>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" disabled={!enabled} checked={ack} onChange={(e) => setAck(e.target.checked)} /> Send to {destination ?? "—"}
      </label>
      <button
        className={buttonClass("outline")}
        disabled={!enabled || !ack || busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/settings/test-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, destinationShown: destination }) });
          const b = await r.json();
          setBusy(false);
          setAck(false);
          setRes(r.ok ? { ok: true, text: `Sent · Resend id ${b.providerMessageId}` } : { ok: false, text: b.error });
        }}
      >
        {busy ? "Sending…" : "Confirm test send"}
      </button>
      {!enabled && <p className="text-xs text-danger">Unavailable: email sending is not configured for test mode.</p>}
      {res && <p className={`text-xs ${res.ok ? "text-ok" : "text-danger"}`}>{res.text}</p>}
    </div>
  );
}
