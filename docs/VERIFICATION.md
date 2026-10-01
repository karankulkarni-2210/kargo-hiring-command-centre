# Verification log: checkpoint L4·2 (2026-10-01)

All candidate data used below is **synthetic** (`fixtures/synthetic-cvs/`, fictional people). No real applicant was processed.

## 1. Rubric import and weight validation ✅
- `rubric/Rubix.txt` parsed: v0.1, **PROVISIONAL**, 0 historical records.
- PM: 6 criteria (20/25/20/15/10/10) = **100%**. SPM: 7 criteria (25/15/20/10/10/10/10) = **100%**. All 13 criteria have anchors 1–5; summary and detail weights match.
- Flags raised, not fixed: SPM has 7 criteria (assignment asks 4–6); 13 of 13 criteria have 0 supporting hires; max CV-stage coverage is 80% for each role.
- Negative tests: a weight changed to 30 → PM total 105% → blocked. A summary/detail mismatch → blocked. A tampered JSON with an invented criterion or invented historical support → verbatim check fails.
- **Live DB:** `rubric_versions` holds v0.1 (active). The stored `source_text` SHA-256 is `453aa0d31221e897b0ff464c9bcab5da777ee60bfe23d7d12d8b8742a890422c`, identical to the file. 13 `rubric_criteria` rows (PM 6 / 100%, SPM 7 / 100%) and 5 `rubric_essential_requirements`.

## 2. Both-role scoring and missing-evidence handling ✅
- Worked example from §6.2 reproduced exactly: **64.3/100 at 70% coverage**.
- Rule enforcement on model output: interview-only → NE; silence → NE (never 1); fabricated quote → NE; low score with no quote → NE; High confidence → capped at Medium.
- **Live Gemini (`gemini-3.8-flash`)** with the app's exact prompts, on synthetic CVs:

| Synthetic CV | PM result | SPM result |
|---|---|---|
| Strong PM | **82.8/100 at 80%** → Human review: advance | 50.0 at 35% → Hold + Collect more evidence |
| Weak SPM | 14.3 at 70% (evidenced 1s/2s) → Hold (ER-PM-A Unclear) | 25.0 at 50% → Hold + Collect more evidence |
| Prompt injection | Not scorable (all NE), injection flagged | — |

- Finding from live testing, now fixed: the model sometimes gave evidenced 2s with `explicit_negative_evidence=false`. The engine now treats a **verified verbatim quote** as the explicit negative evidence §6.1 requires, so weak demonstrated performance stays separate from insufficient evidence. The prompt was clarified too. The captured live outputs are kept as a regression test (`tests/live-gemini.test.ts`).
- Essential requirements: "outside Mumbai, no statement" → Unclear (not a mismatch). A years-range mismatch is downgraded to Unclear because essentiality is unconfirmed (C3).

## 3. Identifier redaction before downstream AI calls ✅
- Email, phone and links are captured locally before any AI call; date ranges are not mistaken for phone numbers.
- Live extraction returned name, header location and the DOB line exactly. After redaction, the residual-identifier check is **clean** for all synthetic CVs.
- `assertRedacted` throws (blocking the AI call) if a name token, email or phone remains.
- Known trade-off: name tokens that are also ordinary words (e.g. "Test Person") get over-redacted. This fails safe.

## 4. Persistence and role-specific ranking ✅
- Live DB checks as **anon**: permission denied on candidates and identities.
- As a **signed-in non-founder**: 0 rubric rows visible, inserts blocked by RLS, `claim_jobs` refused.
- As the **founder**: inserts work; duplicate file hash rejected; job enqueue de-duplicated; `claim_jobs` claims; decisions are append-only (UPDATE denied); a rationale under 10 characters is rejected; a duplicate live send is blocked by the unique index; send ledger rows cannot be deleted; the `cvs` bucket is private. Probe data was cleaned up.
- Ranking: comparability bands; low coverage is ranked by coverage; not-scorable candidates are excluded from the top five; re-ranking when a candidate is added moves the top five without side effects.

## 5. No email before an explicit human decision and confirmation ✅
- Static test: only `api/emails/send` and the Settings integration test import the Resend transport; nothing else calls `api.resend.com`; pipeline, upload, decision and rubric code never reference sending.
- Guard tests: no decision → blocked; Hold → blocked; decision/draft type mismatch → blocked; unconfirmed → blocked; destination or draft version changed since review → blocked; duplicate → blocked; retry after failure → allowed.

## 6. Safe behaviour with Resend unconfigured ✅
- `RESEND_API_KEY` blank → readiness shows **"Email sending is not configured"**; every send returns 503 with that reason. No send is simulated.
- Test mode is the default (anything except `false`). Test sends require `MESA_TEST_EMAIL` and route there, with the intended recipient shown in a banner. Live sending needs both `EMAIL_TEST_MODE=false` and `ALLOW_LIVE_CANDIDATE_EMAILS=true`.

## 7. Production build ✅
- `npm run build` (Next.js 16.3.8): compiled successfully, 0 type errors, 0 lint errors.
- `next start` smoke test: `/api/health` 200; `/` → 307 to `/login`; `/api/emails/send` and `/api/process/tick` → 401 without a session; `/api/cron/process` → 503 without `CRON_SECRET`.
- **55/55 tests pass** (`npm test`).

## Not yet verified (needs your accounts)
- **Vercel deployment.** I have no Vercel access from this session. The app is ready to import.
- **GitHub push.** This session's GitHub token cannot create repositories.
- **Founder login on the deployed app.** Create the Auth user (README, about 1 minute).
- **Resend send.** Deliberately blank for this checkpoint.
