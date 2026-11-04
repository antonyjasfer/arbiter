# Arbiter

Freelance software work gets paid when evidence shows it was delivered. Entry for the PayPal AI Hackathon (Devpost).

1. A client pastes a project brief; Arbiter's AI turns it into milestones with testable acceptance criteria.
2. Both parties approve; the client funds a milestone with a **PayPal sandbox authorization**.
3. The freelancer submits a GitHub repo at a pinned commit and a deployed URL.
4. Tests and Playwright checks run on a fresh GitHub Actions runner with no secrets; each criterion gets PASS, FAIL or NEEDS HUMAN REVIEW with linked evidence.
5. The client approves; server code captures the payment and sends a PayPal Payout. The AI can never move money.

> **Status:** Phase 3 (agreements): a brief becomes an AI-drafted, checked, versioned agreement that both parties approve and lock, with a hash-chained audit log and a two-click demo. Verification and payments arrive in Phases 4 and 5.

## Try the demo

On the live site, "Try the demo" signs you in as a seeded client (Dana) or freelancer (Femi), with no account. Open **TaskBoard** as each party and approve it to lock the agreement, then check its audit log. Open **Bakery website** and press "Draft with AI" to see the AI's milestones and its questions about a vague brief. The demo is shared by everyone using it at that moment, and "Reset demo" restores it for all of them. Demo users can only reach demo projects, and real users never see demo data.

## Honest limits

- **Sandbox only.** No real money moves. Live PayPal credentials are never used.
- **Not an escrow service.** Arbiter is a hackathon demo, not a licensed escrow or money transmitter. The platform-collects-then-pays-out model would need PayPal platform approval in production.
- **Authorizations** are valid for 29 days with a 3-day honor period (measured in sandbox: `expiration_time` 29 days after authorization).
- **Captures can stay PENDING** (sandbox PENDING_REVIEW); payout waits for a COMPLETED capture.
- **Runner egress is open.** GitHub-hosted runners have no network allow-list. Untrusted code runs in its own job with no secrets and `permissions: {}`, inputs are validated, runs are limited to 10 minutes and public repos only.
- **AI drafts are proposals.** Gemini proposes milestones and acceptance criteria; Arbiter rejects any draft whose amounts don't add up to the budget, that has a milestone under $50, or that has a criterion without a kind. Both parties must then approve the exact version (by its SHA-256 hash). Briefs are treated as data, not instructions, and a brief that addresses the AI is flagged. Live drafts are capped at 10 per user per day (20 per day for the whole demo); cached demo drafts don't count.
- **Briefs go to Google.** A client's brief, budget and answers are sent to the Gemini free tier, which may use them to improve Google's products. The form says so above the brief field.
- **Audit log limit.** Each event's hash covers the previous one and the project stores the latest hash, so editing, deleting or reordering events is detected. Someone with write access to the whole database could still rewrite both; the head hash is not anchored anywhere public.
- **Free tiers:** Render Free sleeps after 15 minutes idle (first request after that took about 24 s in testing); Neon suspends after 5 minutes; the Gemini free tier is rate-limited (designed for 10 RPM / 250 RPD) and Google may use prompts to improve its products, so only public repo content and seeded text are sent.

## Architecture

- `web/`: Next.js 16 App Router app (TypeScript strict, Tailwind + shadcn/ui, Auth.js v5 with GitHub, Drizzle on Neon Postgres). All PayPal calls are server-side in `web/src/server/paypal/`.
- Milestone states are a typed transition table (`web/src/server/milestones/state-machine.ts`); every change is one guarded `UPDATE … WHERE state = expected AND state_version = n`.
- PayPal webhooks (`POST /api/webhooks/paypal`) are signature-verified with PayPal, stored once per event id, and reconciled by reading the resource back from PayPal.
- `arbiter-runner` (separate public repo): the `workflow_dispatch` verification workflow.
- `spikes/`: Phase 1 integration spikes and their findings (`spikes/FINDINGS.md`).

## Local setup

Requirements: Node 24, npm.

1. Copy `.env.example` to `.env.local` **at the repo root** and fill it in. Both `web/` and `spikes/` read this one file; it is git-ignored.
2. Create two GitHub OAuth apps (GitHub → Settings → Developer settings → OAuth Apps):
   - **"Arbiter (local)"**: homepage `http://localhost:3000`, callback `http://localhost:3000/api/auth/callback/github`. Its id and secret go in `.env.local` as `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.
   - **"Arbiter"** (live): homepage `https://arbiter-q41f.onrender.com`, callback `https://arbiter-q41f.onrender.com/api/auth/callback/github`. Its id and secret go **only** in the Render dashboard.
3. Install and run:

```bash
cd web
npm ci
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and sign in with GitHub.

## Tests

```bash
cd web
npm run lint
npm run typecheck
npm test
```

Database tests run against PGlite (in-process Postgres) with the real migrations, so they need no database or secrets. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build for `web/`, and typecheck and tests for `spikes/`.

## Deploy (Render Free, Virginia)

`render.yaml` declares the `arbiter` web service: root directory `web`, build `npm ci && npm run build`, start `npm run start`, health check `/api/health`. Secrets are set in the Render dashboard, never in the file: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (live OAuth app), `DATABASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`; plus `PAYPAL_ENVIRONMENT=SANDBOX`, `NODE_VERSION=24` and `AUTH_URL=https://arbiter-q41f.onrender.com`. `AUTH_URL` is required on Render: without it Auth.js builds the GitHub callback from the proxied host header (`https://localhost:10000`) and GitHub rejects the sign-in.

`render.yaml` is a record, not a synced Blueprint: syncing it would create a second, suffixed service rather than adopt the existing dashboard-created one, so the same settings are applied in the dashboard.

Migrations are run from a developer machine (`npm run db:migrate`), not on deploy. Also set `GEMINI_API_KEY` and `DEMO_MODE=true` in Render. If you set `GEMINI_MODEL`, it must match the model the demo cache was made with (`gemini-3.6-flash`), or the cached demo drafts are skipped.

To refresh the cached demo drafts after changing the compiler prompt or a seed brief (a test fails until you do), run from `web/`: `node --conditions=react-server --import tsx scripts/warm-demo-cache.ts`. It makes real Gemini calls and writes only drafts that pass the checks. On Windows, a `GEMINI_API_KEY` set in your user environment overrides `.env.local`, so remove it there.

## License

MIT. See `LICENSE`.
