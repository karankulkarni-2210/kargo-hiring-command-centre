"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, buttonClass, cx } from "@/components/ui";
import type { DraftRow } from "@/lib/data";

export function DecisionForm({ candidateId, current }: { candidateId: string; current: "advance" | "hold" | "decline" | null }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"advance" | "hold" | "decline" | null>(current);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const opts = [
    { k: "advance", label: "Advance", hint: "Invite to next stage", cls: "data-[on=true]:border-ok data-[on=true]:bg-ok/10 data-[on=true]:text-ok" },
    { k: "hold", label: "Hold", hint: "Verify / revisit", cls: "data-[on=true]:border-warn data-[on=true]:bg-warn/10 data-[on=true]:text-warn" },
    { k: "decline", label: "Decline", hint: "Not moving forward", cls: "data-[on=true]:border-danger data-[on=true]:bg-danger/10 data-[on=true]:text-danger" },
  ] as const;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {opts.map((o) => (
          <button key={o.k} data-on={decision === o.k} onClick={() => setDecision(o.k)} className={cx("focus-ring rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-text/30", o.cls)}>
            <div className="text-sm font-semibold">{o.label}</div>
            <div className="text-[11px] text-muted">{o.hint}</div>
          </button>
        ))}
      </div>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        rows={3}
        placeholder="Your rationale (required) — e.g. strongest evidence, what to verify, why not now…"
        className="focus-ring w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm placeholder:text-faint"
      />
      {err && <p className="text-xs text-danger">{err}</p>}
      {ok && <p className="text-xs text-ok">Decision recorded. No email was sent.</p>}
      <button
        className={buttonClass("primary")}
        disabled={!decision || rationale.trim().length < 10 || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          setOk(false);
          const r = await fetch(`/api/candidates/${candidateId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, rationale }) });
          const b = await r.json();
          setBusy(false);
          if (!r.ok) return setErr(b.error);
          setOk(true);
          setRationale("");
          router.refresh();
        }}
      >
        {busy ? "Recording…" : "Record decision"}
      </button>
    </div>
  );
}

type DraftView = {
  kind: "invite" | "rejection";
  draft: DraftRow | null;
  preview: { subject: string; body: string; unresolved: string[] } | null;
  eligibility: { allowed: boolean; reasons: string[]; code?: string } | null;
};

export function DraftWorkspace(props: {
  candidateId: string;
  initialKind: "invite" | "rejection";
  suggestedKind: "invite" | "rejection";
  decisionKind: "invite" | "rejection" | null;
  destination: string | null;
  mode: "test" | "live";
  intended: string | null;
  candidateName: string | null;
  drafts: DraftView[];
}) {
  const [kind, setKind] = useState(props.initialKind);
  const view = props.drafts.find((d) => d.kind === kind)!;
  return (
    <div className="rounded-xl border border-line bg-surface/80 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
          {(["invite", "rejection"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx("focus-ring rounded-md px-3 py-1.5 text-xs font-medium capitalize", kind === k ? "bg-surface-3 text-text shadow-[0_0_0_1px_#283344]" : "text-muted hover:text-text")}>
              {k} draft
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {props.suggestedKind === kind && <Badge tone="accent">Suggested by shortlist position</Badge>}
          {props.decisionKind === kind && <Badge tone="ok">Matches your decision</Badge>}
        </div>
      </div>
      <DraftPanel key={`${kind}-${view.draft?.id ?? "none"}-${view.draft?.version ?? 0}`} {...props} view={view} />
    </div>
  );
}

function DraftPanel({ candidateId, view, destination, mode, intended, candidateName, decisionKind }: Parameters<typeof DraftWorkspace>[0] & { view: DraftView }) {
  const router = useRouter();
  const [subject, setSubject] = useState(view.draft?.subject_template ?? "");
  const [body, setBody] = useState(view.draft?.body_template ?? "");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const dirty = view.draft && (subject !== view.draft.subject_template || body !== view.draft.body_template);

  if (!view.draft)
    return (
      <div className="space-y-3 p-5 text-sm text-muted">
        <p>No {view.kind} draft yet. Drafts are generated automatically after ranking (top five → invite, others → rejection).</p>
        <button
          className={buttonClass("outline")}
          disabled={busy !== null}
          onClick={async () => {
            setBusy("gen");
            const r = await fetch(`/api/candidates/${candidateId}/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: view.kind }) });
            setBusy(null);
            setMsg(r.ok ? { tone: "ok", text: "Draft queued — it will appear shortly." } : { tone: "danger", text: (await r.json()).error });
            window.dispatchEvent(new Event("kargo:process"));
          }}
        >
          Generate {view.kind} draft
        </button>
        {msg && <p className={msg.tone === "ok" ? "text-xs text-ok" : "text-xs text-danger"}>{msg.text}</p>}
      </div>
    );

  return (
    <div className="grid gap-0 xl:grid-cols-2">
      <div className="space-y-3 border-b border-line p-5 xl:border-b-0 xl:border-r">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Template · v{view.draft.version}</div>
          <Badge>{view.draft.origin === "ai" ? `AI · ${view.draft.model ?? ""}` : "Edited by you"}</Badge>
        </div>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="focus-ring w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="focus-ring w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed" />
        <p className="text-[11px] text-faint">
          Placeholders: <code>{"{{first_name}}"}</code> <code>{"{{role_title}}"}</code> <code>{"{{company_name}}"}</code> <code>{"{{sender_name}}"}</code> — the real name is filled in on the server for preview and send.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass("primary")}
            disabled={!dirty || busy !== null}
            onClick={async () => {
              setBusy("save");
              setMsg(null);
              const r = await fetch(`/api/drafts/${view.draft!.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body, expectedVersion: view.draft!.version }) });
              const b = await r.json();
              setBusy(null);
              if (!r.ok) return setMsg({ tone: "danger", text: b.error });
              setMsg({ tone: "ok", text: "Saved as a new version. Review the preview again before sending." });
              router.refresh();
            }}
          >
            {busy === "save" ? "Saving…" : "Save edit"}
          </button>
          <button
            className={buttonClass("ghost")}
            disabled={busy !== null}
            onClick={async () => {
              setBusy("regen");
              const r = await fetch(`/api/candidates/${candidateId}/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: view.kind }) });
              setBusy(null);
              setMsg(r.ok ? { tone: "ok", text: "Regeneration queued." } : { tone: "danger", text: (await r.json()).error });
              window.dispatchEvent(new Event("kargo:process"));
            }}
          >
            Regenerate with AI
          </button>
        </div>
        {msg && <p className={msg.tone === "ok" ? "text-xs text-ok" : "text-xs text-danger"}>{msg.text}</p>}
      </div>

      <div className="space-y-3 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Exactly what will be sent</div>
        <div className="rounded-lg border border-line-strong bg-bg/60">
          <div className="space-y-1 border-b border-line px-4 py-3 text-xs">
            <div className="flex gap-2">
              <span className="w-14 text-faint">To</span>
              <span className={cx("font-mono", destination ? "text-text" : "text-danger")}>{destination ?? "no destination — sending blocked"}</span>
              {mode === "test" ? <Badge tone="cyan">TEST MODE</Badge> : <Badge tone="danger">LIVE</Badge>}
            </div>
            {mode === "test" && (
              <div className="flex gap-2">
                <span className="w-14 text-faint">Intended</span>
                <span className="font-mono text-muted">{candidateName ?? "?"} &lt;{intended ?? "not extracted"}&gt; — not contacted</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="w-14 text-faint">Subject</span>
              <span>{view.preview?.subject}</span>
            </div>
          </div>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-[13px] leading-relaxed text-text/90">{view.preview?.body}</pre>
        </div>
        {dirty && <p className="text-xs text-warn">You have unsaved edits — save them; the preview and send use the saved version.</p>}
        {view.preview?.unresolved.length ? <p className="text-xs text-danger">Unresolved placeholders: {view.preview.unresolved.join(", ")}</p> : null}

        {view.eligibility && !view.eligibility.allowed && (
          <ul className="space-y-1 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
            {view.eligibility.reasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        )}
        {view.eligibility?.allowed && decisionKind === view.kind && (
          <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5" />
              <span>
                I have reviewed this email and confirm it should go to <span className="font-mono text-text">{destination}</span>
                {mode === "test" ? " (MESA test inbox)." : " — a real candidate."}
              </span>
            </label>
            <button
              className={buttonClass(mode === "live" ? "danger" : "primary") + " w-full"}
              disabled={!reviewed || dirty === true || busy !== null}
              onClick={async () => {
                setBusy("send");
                setMsg(null);
                const r = await fetch("/api/emails/send", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ candidateId, draftId: view.draft!.id, draftVersionShown: view.draft!.version, destinationShown: destination, confirm: true }),
                });
                const b = await r.json();
                setBusy(null);
                setReviewed(false);
                if (!r.ok) setMsg({ tone: "danger", text: b.error });
                else setMsg({ tone: "ok", text: `Sent to ${b.to} · Resend id ${b.providerMessageId}` });
                router.refresh();
              }}
            >
              {busy === "send" ? "Sending…" : "Confirm to Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
