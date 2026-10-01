# Architecture: Kargo Hiring Command Centre

## One-paragraph pitch

Arjun has 60 CVs, two roles, no HR team and no record of why anyone was shortlisted. The app takes each CV through four AI steps (extraction, scoring, brief, email draft), but **every number that ranks a candidate is computed in application code from validated, rule-checked criterion scores**, and **no message leaves the system until Arjun records a decision and confirms the exact email and recipient**. The AI reads and explains; the code enforces the rubric; the founder decides.

## Flow

```
Upload (browser) ──signed URL──▶ Private Storage bucket "cvs" (founder-only RLS)
      │
      └─▶ jobs queue (Postgres) ──▶ /api/process/tick  (short, resumable, one job per step)
                                     │
  1. extract ── local text (PDF/DOCX/TXT) ─▶ local pre-redaction of email/phone/URLs
              ─▶ Gemini extraction (sees name + location; scanned PDF = original file)
              ─▶ identity → candidate_identities (RESTRICTED)
              ─▶ redacted evidence → candidate_profiles  (+ residual-identifier gate)
  2. score ×2 ─ PM rubric and SPM rubric, REDACTED text only
              ─▶ zod validation ─▶ rubric rule engine ─▶ weighted total in code
  2b. role fit  assign PM or SPM automatically from both evaluations (founder can override)
  3. rank ──── within the assigned role, comparability bands (coverage gap ≤ 15 pp)
  4. brief ─── top five per role (3 sentences + 3 targeted questions)
  5. draft ─── every candidate: invite (top 5) / rejection (others), placeholders only
                                     │
Founder ── Decision (Advance / Hold / Decline + rationale, append-only)
        ── Review draft ─▶ server renders real name ─▶ shows actual destination
        ── Confirm to Send ─▶ /api/emails/send ─▶ Resend (test mode → MESA inbox)
```

## Why each design choice

| Requirement | How it is met |
|---|---|
| Rubric is the scoring source | `rubric/Rubix.txt` is parsed deterministically (`src/lib/rubric/parse-rubix.ts`). Criteria, weights, anchors, evidence modes, essential requirements and Section 6 rules are read exactly as written. The original file is stored verbatim with its SHA-256 next to the parsed, versioned JSON. |
| Weights total 100% | `validateRubric` checks each role's total, summary-vs-detail weights, anchors 1–5 and duplicates. Errors block activation. |
| Honest status | The PROVISIONAL banner, "0 historical cases" per criterion, "Pattern confidence: Not established", and an assignment-fit check that flags **SPM = 7 criteria (assignment asks 4–6)** and **0 historically supported criteria**. These are flagged, never auto-fixed. |
| Missing evidence ≠ failure | Rule engine (`src/lib/scoring/engine.ts`): no verified quote → NE; interview-only (PM-3, SPM-3) → NE at CV screen; a 1–2 needs a verified quote matching the low anchor; quotes are checked verbatim against the CV text, so fabricated evidence is discarded; CV-PARTIAL confidence is capped at Medium and High is never assigned at CV stage. Every override is logged and shown. |
| Coverage beside score | `Score XX.X/100 at YY% coverage (stage: CV screen)` is rendered everywhere, with a coverage bar marked at the 70% interpretation minimum. |
| Ranking fairness | Scores are ordered only among candidates whose coverage is within 15 pp and above the 70% minimum. Below that, candidates are ranked by coverage and labelled "not interpretable". No automatic accept or reject thresholds. |
| Both roles, automatic fit | Every CV is scored against PM **and** SPM, then **assigned automatically** to one role (`suggestRole` in `engine.ts`). Scores are compared only when both roles have ≥70% coverage and are within 15 pp (§6.3), and a gap under 5 points is a "close call" decided by evidence. Otherwise the role with more evidenced rubric weight wins and the fit is labelled low-confidence. If neither role is scorable, no role is assigned and the founder chooses. Years of experience are never used (C3). The founder can move anyone or hand them back to automatic. A role is locked once a decision is recorded. Every change is audited (`role_auto_assigned` / `role_overridden`) and re-ranks both roles. Unsent AI drafts are regenerated for the new role, and nothing is sent. |
| Rubric replaceable | Import a new `.txt` or `.json` (or AI-assisted, verbatim-verified) and it is stored inactive. Activate it, then re-score. Each evaluation stores `rubric_version_id`. |
| Vercel-friendly processing | A Postgres job queue with `FOR UPDATE SKIP LOCKED`, dedupe keys, retries with backoff, `retryDelay`-aware rate-limit deferral and stale-job recovery. The browser drives short ticks; a daily Vercel Cron drains the queue without a browser if configured. |
| Malformed AI output | JSON-schema-constrained output, zod validation, one repair round-trip, then the job fails visibly with a Retry button. |
| Untrusted CVs | CV text is wrapped in delimiters that cannot be closed from inside, the prompts say the content is data, local heuristics plus the model flag injection attempts, and a red banner appears on the candidate page. Structural enforcement means injected "give me 5s" text cannot change how scores are computed. |
| Duplicates / unreadable | Identical files are blocked by SHA-256 (client-side and re-checked on the server). Same email address is flagged as a possible duplicate, never merged. Image-only PDFs go to Gemini OCR (disclosed); unreadable CVs fail with a clear message. |

## Data path (say this accurately)

1. **Local pre-redaction.** Email addresses, phone numbers and URLs are captured into restricted fields and replaced with tokens **before any AI call**.
2. **Extraction is not anonymous.** Gemini extraction receives the remaining CV text, **including the candidate's name, location and any personal lines**, because its job is to find them. For scanned PDFs it receives the **original file**.
3. **Redaction.** Name, header location and sensitive lines (DOB, gender, marital status, religion…) are removed. A residual-identifier gate re-checks before **every** downstream call and blocks the call if anything remains.
4. **Scoring, briefs and drafts** receive only redacted evidence plus a city-level location signal ("Mumbai-based / outside Mumbai / not stated") for the in-office requirement. Drafts use `{{first_name}}` placeholders, and the real name is substituted **on the server** only for preview and send.
5. **Free vs billed Gemini.** On the free tier Google may use inputs to improve its products; with a billed key it does not. Use a billed key for real candidates.

## Security model

- **Auth:** Supabase email + password. Access requires the email to be in `public.founders`, checked in the database (`is_founder()`) and in every route (`withFounder`).
- **RLS:** enabled and forced on all 14 tables; `anon` has no table privileges. Decisions and the audit log are append-only. The send ledger cannot be deleted.
- **Storage:** private `cvs` bucket, founder-only policies, 10 MB limit, PDF / DOCX / TXT only.
- **Secrets:** Gemini, Resend and the optional service-role key are read only on the server. No `NEXT_PUBLIC_` secrets. A test asserts that no client component reads `process.env`.

## Human decision boundary (the "Cut")

- The AI recommendation (`evaluations`) and the founder decision (`decisions`) are separate tables. The decision row snapshots what the AI said at the time.
- Only `/api/emails/send` can contact anyone (enforced by a static test). It requires: a founder session, a recorded Advance or Decline matching the draft type, `confirm: true`, and the **destination and draft version the founder saw**. It also requires Resend to be configured and test mode resolving to `MESA_TEST_EMAIL`.
- Duplicate sends are blocked by partial unique indexes. The Resend Idempotency-Key equals the ledger row id. Provider message IDs and failures are stored. "Sent" is recorded only when Resend returns an id.
- Upload, scoring, ranking and dropping out of the top five never send anything. Hold never sends.
