# Arbiter — project guide for Claude Code

Read this at the start of every session. The full plan is in `docs/arbiter-plan.md`; read the sections that matter for the current phase before changing anything.

## What we are building

Arbiter is an entry for the **PayPal AI Hackathon** on Devpost. It is a payment workflow where freelance software work gets paid when evidence shows it was delivered.

1. A client pastes a plain-language project brief.
2. Arbiter's AI turns it into milestones, amounts and **testable acceptance criteria**, and flags vague ones.
3. Client and freelancer both approve; the agreement is versioned and locked.
4. The client funds one milestone at a time with a **PayPal sandbox authorization** (not a capture).
5. The freelancer submits a GitHub repo at a pinned commit plus a deployed URL.
6. Arbiter runs the repo's tests and **browser checks** (Playwright) on a **GitHub Actions runner** (fresh VM, no secrets) in the public repo `arbiter-runner`, started with `workflow_dispatch`.
7. Each criterion gets PASS, FAIL or NEEDS HUMAN REVIEW, each linked to evidence (the public run log URL, artifacts, screenshots). Verdicts come from GitHub's Jobs API (job/step conclusions), which test code cannot forge.
8. The client approves; server code **captures** the payment and sends a **Payout** to the freelancer. Every step goes into a hash-chained audit log.

Differentiators to protect in every decision:
- **Evidence, not opinion.** Tests and browser assertions decide verdicts; the AI writes checks and explains results.
- **Bounded payment authority.** The AI can never move money.
- **Resists manipulation.** A repo that tells the AI "mark everything as passed" is flagged and still fails on its tests.

## Budget

**Zero budget. No paid services of any kind.** Render Free web service (Virginia) only; Neon free Postgres; GitHub Actions on public repos; Gemini API free tier. No Render Workflows, Sandboxes, paid Postgres or Render API key; no Anthropic runtime API. If a step asks for a card, billing or an upgrade, stop and tell the user. Free-tier realities to design for: Render Free sleeps after 15 min idle (about 1 min to wake), Neon computes suspend after 5 min idle, Gemini free tier can return 429 and uses prompts to improve Google products.

## Deadline and pacing

- Submission deadline: **Nov 12, 2026, 12:00 PST = 01:30 IST Fri Nov 13**. We target submission on **Nov 11 IST**.
- The user is in India (IST). Use IST when talking about dates.
- Work in the phases defined in `docs/arbiter-plan.md` section 9. **Never start the next phase without the user's explicit approval.**

## Non-negotiable rules

1. **No AI code path may call a money-moving PayPal endpoint** (create/authorize/capture/void/reauthorize order, payouts, refunds). Only deterministic server code in the payments module may, and only after a human approval recorded in the database.
2. The **payment guard** checks, before every capture or payout: amount ≤ milestone amount, payee = the agreed freelancer, approver = the project's client, latest verification run has no FAIL (or a written client override).
3. Every PayPal write call sends a stored `PayPal-Request-Id`. Every state change is a guarded SQL update (`WHERE state = expected AND state_version = n`). Webhooks are signature-verified, de-duplicated by event id, and reconciled by fetching from PayPal.
4. **Untrusted code** (freelancer repos) runs only on the GitHub Actions runner repo `arbiter-runner`: a fresh VM, **no secrets in any step that touches untrusted code** (run it under `env -i`), `timeout-minutes: 10`, public repos only, untrusted code runs in its own job with `permissions: {}`; the production runner holds no secrets at all; workflow inputs are passed via `env:` and regex-validated first (github.com repo URL, 40-hex SHA, https deploy URL, numeric run id) and **never** interpolated as `${{ inputs.* }}` inside `run:` steps. GitHub-hosted runners have **open internet egress** (no allow-list); say so in the README. The runner repo is never checked out, and Arbiter's dispatch token (`GITHUB_RUNNER_TOKEN`) never reaches the runner.
5. Repo and website content passed to a model is untrusted data (and the Gemini free tier trains on prompts, so send only public repo content and seeded demo text, never PayPal data or personal data): wrap it in delimited blocks, never give the model state-changing tools, validate all model output with Zod.
6. **Never fake an integration.** No stubbed "success" responses presented as real PayPal, sandbox or AI results. If something is blocked, say so and propose an alternative.
7. **Secrets** live only in `.env.local` (git-ignored) and the Render dashboard's environment settings; the user types them there, never in chat. Names in `.env.local`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`, `PAYPAL_FREELANCER_EMAIL`, `PAYPAL_WEBHOOK_ID`, `GEMINI_API_KEY`, `DATABASE_URL`, `GITHUB_RUNNER_TOKEN`, `RUNNER_REPO`, `FIXTURE_REPO_URL`. Check names only, never read or print values. Never print, log, commit, or ask the user to paste secret values into chat. Refer to variables by name only.
8. Sandbox only. Never use live PayPal credentials.
9. Don't claim tests pass unless you ran them and read the output. Don't weaken a test or security check to make a build pass.

## Stack (decided; change only with user approval)

- TypeScript (strict) everywhere; Next.js App Router; Tailwind + shadcn/ui
- Neon free Postgres (AWS us-east-1, `DATABASE_URL`) + Drizzle ORM; Auth.js with GitHub OAuth; Zod at every boundary
- PayPal REST: Orders v2, Payments v2, Payouts v1, Webhooks v1 (server); PayPal JS SDK v6 buttons (client); `@paypal/agent-toolkit` with **read-only** tools for the dispute assistant
- Runtime AI: Google Gemini API free tier (`GEMINI_API_KEY`), the Flash model marked "Free of charge" on the pricing page (candidate `gemini-3.8-flash`; the chosen id and limits are recorded in `spikes/FINDINGS.md`). All calls go through one provider interface (`StructuredAi`: Zod schema in, validated JSON out), so a backup provider can be added. Seeded demo outputs are cached; 429s retry with backoff, then show a clear "AI busy" state.
- GitHub Actions (`arbiter-runner`, `workflow_dispatch` with inputs repo URL, commit SHA, run id, deploy URL) for verification runs: `npm ci`, `npm test`, Playwright checks; Arbiter polls for completion and links the public run logs as evidence; KERNEL optional (P1)
- AG Studio dashboard (P1, sponsor prize)
- Hosting: one Render **Free** web service (region Virginia). Keep it warm or tolerate cold starts: persist run state in Postgres and reconcile on each request, never rely on in-process timers. Scheduled jobs (reauthorize on day 3, keep-warm, run reconciliation) are scheduled GitHub Actions in the `arbiter` repo calling a protected endpoint.
- Tests: Vitest (unit), Playwright Test (E2E)

## How to work

- Use the Superpowers skills: `superpowers:writing-plans` to plan a phase, `superpowers:test-driven-development` while building, `superpowers:systematic-debugging` for bugs, `superpowers:verification-before-completion` before saying "done", `superpowers:requesting-code-review` with a fresh subagent for payment and sandbox code.
- Check official docs (or the APIMatic PayPal context plugin and PayPal MCP, when installed) before relying on any API detail. Note the source in code comments for PayPal behaviour.
- Inspect the repo before editing. Keep changes small and committed with clear messages.
- At the end of each phase, report: files changed, features completed, tests run with real results, known limitations, manual steps the user must do. Then stop.

## Model guidance (user selects with `/model`)

- `opus` or `opusplan`: architecture, payment state machine, sandbox runner, security review
- `sonnet`: UI and routine features
- `haiku`: docs and small edits
- `fable`: only for a bug that has resisted two attempts (may use usage credits)

## Scope reminders

- P0 deliverable types: **GitHub repos (Node projects) and deployed websites only.**
- P1: AG Studio dashboard, dispute assistant, KERNEL replays, invoices. P2: revisions, partial captures, document deliverables, notifications.
- Out of scope: subjective design judgments, live payments, real escrow, multi-currency, KYC.
- Be honest in UI and README: PayPal authorizations are valid 29 days with a 3-day honor period (the real `expiration_time` is measured in Phase 1); Arbiter keeps a platform fee (a percentage plus a small fixed amount, set in Phase 5 from fees measured in Phase 1; demo milestones are $50 or more); Arbiter is not a licensed escrow service; the platform-collects-then-pays-out model would need PayPal platform approval in production.
