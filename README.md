# Kargo Hiring Command Centre

Founder dashboard for **MESA Case 2 — "Arjun and the Hiring Backlog."** It turns a pile of PM / SPM CVs into a ranked, evidence-backed shortlist per role that Arjun can review in under 10 minutes. **The system recommends; Arjun decides.** Nothing is sent to anyone without his recorded decision and an explicit *Confirm to Send*.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, private Storage, RLS) · Gemini Flash (`gemini-3.8-flash`, configurable) · Resend · GitHub · Vercel.

- Architecture and data path: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What was verified, and how: [`docs/VERIFICATION.md`](docs/VERIFICATION.md)

---

## Pages

| Page | What it does |
|---|---|
| **Dashboard** `/` | Real counts (applications, scored, in pipeline, needs attention, pending decisions, emails sent), live processing status, and separate PM and SPM ranked lists with a "below the line" divider after the top five |
| **Upload** `/upload` | Multiple PDF / DOCX / TXT files, per-file progress, errors, duplicate detection and retry. No role to choose: it is assigned automatically after scoring |
| **Candidate** `/candidates/[id]` | **Role fit** (which role the CV is ranked in, why, and Move to PM / SPM / Back to automatic), scores for **both** PM and SPM, criterion-level evidence with verified quotes, coverage, NE reasons, essential requirements, the 3-sentence brief, targeted interview questions, data-path/privacy panel and processing log |
| **Decision & email** `/candidates/[id]/decision` | AI recommendation (kept separate), Advance / Hold / Decline with rationale, editable invite/rejection drafts, rendered preview with the actual destination, explicit Confirm to Send, send history with provider IDs |
| **Rubric** `/rubric` | Criteria, weights, anchors, source support, version, PROVISIONAL status, assignment-fit flags, the original source file, import/activate/re-score/export |
| **Settings** `/settings` | Integration readiness (live DB query, Gemini check, Resend state), email mode, test-recipient configuration, data-path explanation. No secrets are shown |

---

## Local setup

```bash
npm install
cp .env.example .env.local      # fill in the values (see the comments in the file)
npm run dev                      # http://localhost:3000
npm test                         # 55 unit + regression tests
npm run build                    # production build
```

`.env.local` is ignored by git (the `.env*` rule in `.gitignore`). Only `.env.example` is committed.

---

## Supabase (already provisioned)

Project **`kargo-hiring-command-centre`** · ref `cuhqannplwlslcktzpno` · region `ap-south-1` (Mumbai).

Already done in the live project:

1. `supabase/migrations/20261001000001_core_schema.sql`: tables, constraints and indexes.
2. `supabase/migrations/20261001000002_rls_storage_rpc.sql`: RLS on every table, private `cvs` bucket, `enqueue_job` / `claim_jobs` RPCs, founder allowlist seed.
3. **Rubric seeded from `rubric/Rubix.txt`** (v0.1, PROVISIONAL, active). The stored source is byte-identical to the file (SHA-256 `453aa0d3…422c`).

To recreate it in another project: run both migrations in the SQL editor, then `npm run seed:sql` and run the generated `supabase/seed/rubric_seed.sql`. Alternatively, sign in and use **Rubric → Replace the rubric** to import `rubric/Rubix.txt`.

### Create the founder login (one-time, about 1 minute)

1. Open **Supabase Dashboard → Authentication → Users → Add user → Create new user**.
2. Email `karan_kulkarni@pg27.mesaschool.co`, choose a password, tick **Auto Confirm User**.
3. Recommended: **Authentication → Sign In / Providers → Email**, then turn **off "Allow new users to sign up"**.

Only emails in `public.founders` can use the app. To add Arjun or another reviewer, run:
`insert into public.founders(email) values ('someone@example.com');`

---

## Deploy: GitHub → Vercel

```bash
# 1. In this folder
git init -b main            # skip if .git already exists
git add -A && git commit -m "Kargo Hiring Command Centre"
git check-ignore .env.local  # must print ".env.local" (it is NOT committed)

# 2. Create the GitHub repo and push (GitHub CLI), or create it on github.com and add a remote
gh repo create kargo-hiring-command-centre --private --source . --push
```

3. **Vercel → Add New → Project → Import** the repo. The framework is detected as Next.js; keep the default build settings.
4. **Environment Variables** (Production and Preview). Copy them from `.env.local`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `RESEND_FROM_EMAIL`, `EMAIL_TEST_MODE=true`, `MESA_TEST_EMAIL`, `ALLOW_LIVE_CANDIDATE_EMAILS=false`, `EMAIL_SENDER_NAME`.
   Leave `RESEND_API_KEY` **blank** for checkpoint L4·2. Optional: `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` for the daily background worker.
5. **Deploy**, then open `https://<your-app>.vercel.app/api/health`. It should return `"supabaseConfigured": true, "geminiConfigured": true, "resendConfigured": false`.
6. Sign in, open **Settings**: Supabase shows "Connected", Rubric shows "v0.1 active", and "Run Gemini check" returns OK.

### Checkpoint L4·2 is done when
- [ ] Vercel serves the live app (step 5)
- [x] Supabase is connected (verified by live queries; Settings shows a live query on the deployed app)
- [x] The database contains the rubric imported from `Rubix.txt` (verified by SHA-256)

### Later (B·2): enable Resend
Add `RESEND_API_KEY` in Vercel and redeploy. Settings → "Confirm test send" delivers to `MESA_TEST_EMAIL`. Candidate emails stay in test mode until **both** `EMAIL_TEST_MODE=false` **and** `ALLOW_LIVE_CANDIDATE_EMAILS=true`. The `pg27.mesaschool.co` sender domain must be verified in Resend.

---

## Replacing the rubric (no rebuild)

Rubric → **Replace the rubric** → upload a `.txt` in the Rubix layout, or a `.json` export of the rubric schema (use **Export JSON** to get a template). There is also an **AI-assisted** option, which verbatim-checks every name, weight and anchor against the source. Imports are stored inactive with full validation, and weights that don't total 100% block activation. After **Activate**, use **Re-score with active rubric**. Every evaluation records the `rubric_version_id` that produced it.

## Synthetic test fixtures

`fixtures/synthetic-cvs/` contains fictional, clearly labelled CVs: a strong PM, a weak SPM, an ambiguous SPM, a DOCX, a text-layer PDF, an image-only "scanned" PDF and a prompt-injection CV. Use them for checkpoint B·1. They are not real candidates.
