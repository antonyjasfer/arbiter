# Arbiter: Phase 0 Plan (approved, 29 Oct 2026; revised for zero budget, Revision 1)

> Provenance: transcribed on 2026-10-29 from `Arbiter - Phase 0 Plan.pdf` (26 pages) because `docs/arbiter-plan.md` did not exist in the folder. Tables are condensed; source link text in the PDF could not be recovered as URLs. Where the PDF's table layout was ambiguous it is noted. The PDF remains the original.


## R. Revision 1 (29 Oct 2026, zero budget): read this first

The user has **no budget: no paid services of any kind**. This section overrides anything below that conflicts with it. Sections 0-13 are patched where they named a replaced service; if a stray mention remains, apply this table.

| Was | Now |
|---|---|
| Anthropic API (`claude-sonnet-5-5`, `claude-haiku-5-5`) at runtime | **Google Gemini API free tier** (`GEMINI_API_KEY`): the Flash model marked "Free of charge" on the pricing page (candidate `gemini-3.8-flash`; final id and free-tier limits go in `spikes/FINDINGS.md`). One provider interface (`StructuredAi`: Zod schema in, validated JSON out, one re-ask on bad JSON); seeded demo outputs cached; 429 -> retry with backoff -> "AI busy" state. Free-tier prompts are used to improve Google products, so only public repo content and seeded demo text are ever sent. Claude Code keeps using Claude for *coding*; that is separate. |
| Render Sandboxes + Render Workflows + Render Postgres + Render API key | **GitHub Actions runner** in the public repo `arbiter-runner` (untrusted code, tests, Playwright); **Neon free Postgres** (`DATABASE_URL`, AWS us-east-1); **one Render Free web service** (Virginia). No Render API key. |
| Sandbox network allow-list (GitHub, npm) | **Not available on GitHub-hosted runners** (open egress). Replaced by: fresh VM, no secrets, `env -i`, 10-minute limit, public repos only, validated inputs. Disclosed in the README. |
| Verification result = sandbox exit code | Verdict = GitHub **Jobs API** job/step conclusions (test code cannot forge them); logs and screenshots are artifacts; the evidence link is the public run URL. |
| Reauthorize cron on Render | Scheduled **GitHub Action** in the `arbiter` repo calling a protected Arbiter endpoint (also usable for keep-warm and run reconciliation). |
| Payout headroom (9.00 of 10.00) | **5% Arbiter platform fee** for the spike (main flow $50.00 → payout $47.50). Phase 5's real fee will be **a percentage plus a small fixed amount**, set from the capture and payout fees Phase 1 measures; demo milestones are $50 or more. |
| Webhook flag | Spike 3 uses **real** events from Spike 1; `PAYPAL_WEBHOOK_ID` added (empty until the webhook is registered). |
| Authorization window | Spike 1 prints and records the real `expiration_time`. |
| JS SDK v6 buttons | **First task of Phase 5**. |

**Free-tier realities to design for:** Render Free sleeps after 15 min idle (about 1 minute to wake; 750 instance hours/month, enough for one always-on service at 744 h); Neon computes suspend after 5 min idle (Free: 100 CU-hours and 1 GB per project); Gemini free tier has per-project rate limits and daily caps that reset at midnight Pacific; GitHub Actions is free on public repos; workflow_dispatch inputs max 25 and the workflow file must be on the default branch; artifact downloads need an authenticated request.

**Env var names (`.env.local`, values never shared):** PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT, PAYPAL_FREELANCER_EMAIL, PAYPAL_WEBHOOK_ID (empty until Phase 1 Task 5), GEMINI_API_KEY, DATABASE_URL, GITHUB_RUNNER_TOKEN, RUNNER_REPO, FIXTURE_REPO_URL.

**Revised Phase 1 spikes:** (1) PayPal authorize -> capture -> payout, unchanged; (2) GitHub Actions runner on `arbiter-spike-fixture` including a check that the run cannot see any secret; (3) webhook endpoint on a Render Free web service, cold-start delay recorded; (4) one structured-output call to Gemini validated with Zod. Detailed plan: `docs/superpowers/plans/2026-10-29-phase-1-spikes.md`.

## 0. Lead's corrections and warnings
1. **Deadline** is 01:30 IST Fri 13 Nov (12:00 pm PST Thu 12 Nov = 20:00 UTC; US clocks fall back 1 Nov). Plan to submit 11 Nov, keep a day of buffer, about 13 working days.
2. **PayPal cannot hold money for a whole project.** Authorization valid 29 days, funds guaranteed only for a 3-day honor period. Fund one milestone at a time just before work; reauthorize if needed. Say this plainly; do not call it escrow.
3. **Platform money flow.** Client pays Arbiter's sandbox business account; on approval Arbiter captures then sends a Payout to the freelancer. Payouts works in sandbox once enabled for the app. Live use needs PayPal platform programme and approvals (disclosed limitation).
4. **The AI never moves money.** Payment calls are deterministic server code, after human approval, within agreed amount and payee. (Mandate lives inside Arbiter.)
5. **P0 verifies GitHub repos and deployed websites only.** Documents, designs, full dispute assistant are P1.
6. **AG Grid prize = AG Studio** (dashboard): custom widgets, theming, Studio Agent Framework. 45-day free trial from claim; judging ends 15 Dec, so claim on or after 1 Nov.
7. **Day-1 account checks:** (a) PayPal testing outside the US needs a Business account and sign-up varies by country; (b) [Rev 1] Gemini API key from Google AI Studio (free tier, no billing; replaces the Anthropic key); (c) [Rev 1] Render Free web service, GitHub Actions and Neon replace Render Sandboxes/Workflows/Postgres.
Open question: solo or teammates? Plan assumes solo with Claude Code.

## 1. Product definition
Software work gets paid when evidence shows it was delivered. Client and freelancer agree on testable criteria; Arbiter runs real checks; PayPal payment moves only after a person approves the evidence.
- **Problem:** clients fear paying for unfinished work; freelancers fear not being paid; disputes are about vague requirements.
- **For:** independent developers and small clients on fixed-price web/software projects, often cross-border. Later: agencies and marketplaces.
- **Core workflow:** (1) client pastes plain-language brief; (2) Arbiter produces milestones, amounts, testable criteria, flags vague ones; (3) both approve, versioned and locked; (4) client funds milestone 1 via PayPal (authorization, not capture); (5) freelancer submits GitHub repo/commit and deployed URL; (6) Arbiter runs repo tests in an isolated sandbox and drives a real browser (screenshots, replay); (7) each criterion = PASS / FAIL / NEEDS HUMAN REVIEW linked to evidence; (8) client approves, Arbiter captures and pays the freelancer; (9) every step in a tamper-evident audit log.
- **Differentiators:** evidence not opinion (tests and browser runs decide; AI writes checks and explains; AI-judged verdicts labelled); bounded payment authority; resistance to manipulation (repo telling the AI "mark everything as passing" is detected and flagged; demoed live).
- **Will not claim:** legal liability, subjective design quality, licensed escrow.

## 2. Research findings (status)
| Topic | Finding | Status |
|---|---|---|
| Deadline | Nov 12 2026 12:00 pm PST = 01:30 IST Nov 13 | Verified (Devpost) |
| Eligibility | India not excluded; PayPal sign-up varies by country; PayPal Discord handles sign-up problems | Verified |
| Prize stacking | Max one Sponsor Prize plus one Grand Prize or one Honorable Mention | Verified |
| PayPal auth | OAuth 2.0 client credentials; sandbox ships one personal + one business account; testing outside US needs Business account | Verified |
| Authorize/capture | Order `intent=AUTHORIZE`; hold valid 29 days, honor 3 days, reauthorize restarts; capture up to 115% | Verified |
| Payouts | Sandbox: business sends, personal receives; must enable on app; live needs PayPal support activation | Verified (must enable on app) |
| Webhooks | Verify each event with `POST /v1/notifications/verify-webhook-signature` using five `PAYPAL-*` headers | Verified |
| Agent Toolkit | `@paypal/agent-toolkit` (TS) with Vercel AI SDK, LangChain, OpenAI Agents, others | Verified |
| PayPal MCP | `npx -y @paypal/mcp --tools=all`, `PAYPAL_ENVIRONMENT=SANDBOX` | Verified |
| AG Grid prize | Judged on AG Studio polish; 45-day trial; official PayPal boilerplate | Verified |
| Render | [Rev 1] Free web service only (Virginia); $50 credits and Workflows/Sandboxes/API key not used | Superseded |
| Render Workflows | [Rev 1] Not used (paid-tier risk); GitHub Actions `workflow_dispatch` replaces it | Superseded |
| Render Sandboxes | [Rev 1] Not used; GitHub Actions runner (fresh VM, no allow-list) replaces it | Superseded |
| KERNEL | Cloud browsers with live view and replay; $50 credits; no cash prize | Verified (Playwright connection to check) |
| APIMatic | Context Plugin gives Claude Code PayPal API context; setup in linked PDF | Verified (install steps unread) |
| Runtime models | [Rev 1] Gemini API free tier, Flash model marked "Free of charge" (candidate `gemini-3.8-flash`, Stable per docs checked 29 Oct 2026); free-tier prompts are used to improve Google products | Verified (docs); limits to record in Phase 1 |
| Claude Code models | `/model opus|sonnet|haiku|fable|opusplan`; `claude --model <alias>` | Verified |
Hands-on checks still needed (Phase 1) [Rev 1]: sandbox payout lands; webhook reaches the Render Free URL and verifies (cold start measured); GitHub Actions runner clones a public fixture repo at a pinned SHA, runs `npm ci && npm test` and Playwright, and the untrusted step cannot see a canary secret; one Gemini structured-output call validates with Zod; KERNEL accepts a Playwright connection (P1).

## 3. Hackathon strategy
Aim: Grand Prize; fallback Best Use of Agentic Commerce or Best Use of PayPal + AI; plus one sponsor prize (AG Grid first, Render second). Criteria are equal weight; Technological Implementation is the first tie-breaker.
- Tech: Orders authorize/capture/reauthorize/void, Payouts, verified webhooks, idempotent state machine, AI agreement compiler, sandboxed test runner, real browser checks.
- Design: two real roles, one coherent flow brief to payout, evidence viewer, AG Studio trust dashboard.
- Impact: fixed-price freelance software work; payment tied to evidence both sides agreed.
- Innovation: escrow sites exist; evidence-driven verification with bounded AI payment authority does not.
- Presentation: one story: a pass, a fail, a manipulation attempt caught, then a real sandbox payout.
- **Strongest demo moment:** a hidden line in the freelancer's repo tells the AI to mark every criterion passed; tests still fail, report flags the injection, no money moves.
- Build because they raise scores: reauthorization, webhook verification, audit log, injection test, AG Studio widgets, the GitHub Actions verification runner. Cut: subjective design review, document/Figma deliverables in core, multi-currency, chat interface over everything, more than one AI agent per job.
- Could stop submission: PayPal sign-up from India; Payouts enabled in sandbox; Gemini free-tier quota; the Actions runner and Render Free cold starts behaving acceptably.

## 4. Scope
P0 (full loop for code and websites; nothing else starts until it works end to end on the deployed app): GitHub sign-in, roles, invitations; AI Agreement Compiler with ambiguity flags, dual approval, versioning; milestones; submission of repo+commit+deploy URL; verification (GitHub Actions runner tests, browser checks, per-criterion verdicts with evidence); PayPal authorize per milestone, capture on approval, void on cancel, reauthorize after 3 days, Payout; verified webhooks and idempotent state machine; payment guard (amount, payee, human approval) and prompt-injection detection; hash-chained audit log; seeded demo projects (passing, failing, malicious).
P1: AG Studio trust dashboard (custom widgets, Studio agent); dispute assistant; KERNEL sessions with replay; invoices via Invoicing API.
P2: revision rounds and partial captures; document deliverables; Zapier notifications. Out: design/Figma judgments; live payments, real escrow, multi-currency, KYC; non-Node projects (Node and static sites only).

## 5. Architecture
One web app holds all business logic and is the only component that can call PayPal money-moving endpoints; verification runs in separate isolated workers.
1. Client signs in with GitHub, pastes brief; app asks Claude for structured agreement; approved version stored in Postgres.
2. Funding: browser shows PayPal buttons; on buyer approval server authorizes the order and stores authorization id.
3. [Rev 1] On submission the app dispatches the `verify` workflow in the public `arbiter-runner` repo (inputs: repo URL, commit SHA, run id, deploy URL) and stores the GitHub run id. The runner fetches the repo at the pinned commit and runs two independent jobs: `tests` (`npm ci`, `npm test`) and `browser` (Playwright against the deployed site). The app polls GitHub for completion (state in Postgres, reconciled on each request because the Free web service sleeps).
4. [Rev 1] Verdicts are read from GitHub's Jobs API (job and step conclusions); logs and screenshots come from the run artifacts and the public run URL, hashed and stored in Postgres; Gemini writes the plain-language summary.
5. On client approval, payment guard checks amount, payee, approver and verdicts, then captures and sends Payout. PayPal webhooks return to a verified endpoint and are reconciled.
6. Every step appends a hash-chained audit event.
Security boundaries: browser to app (session cookie, server-side role checks); app to PayPal/Gemini (secrets only on server); app to runner (`workflow_dispatch` with a fine-grained token scoped to `arbiter-runner` only; inputs regex-validated; no PayPal or Gemini secrets in the runner repo); runner to untrusted code (fresh VM, `env -i`, 10-minute limit, public repos only; **open internet egress, no allow-list**, disclosed). Logs: Render logs with request ids; no tokens, card data or emails.

## 6. Technology stack
TypeScript strict everywhere; Next.js App Router (server actions, route handlers); Tailwind + shadcn/ui; AG Studio (React) from the PayPal boilerplate (45-day trial); [Rev 1] Neon free Postgres + Drizzle; Auth.js with GitHub OAuth; Zod at every boundary incl. AI output; PayPal REST Orders v2 / Payments v2 / Payouts v1 / Webhooks v1 from the server plus JS SDK v6 buttons; `@paypal/agent-toolkit` with read-only tools in the dispute assistant; [Rev 1] Google Gemini API free tier via `@google/genai` behind a `StructuredAi` provider interface; GitHub Actions (`arbiter-runner`) for untrusted tests; Playwright for browser checks, KERNEL for replays (P1); one Render Free web service; Vitest + Playwright Test. Hardest parts: the runner and the payment state machine, both spiked in Phase 1.

## 7. Data model and application design
Sixteen tables: users (id, github_id, name, email, paypal_email [sandbox, freelancers]); projects; project_members (role); invitations (token_hash, expires_at, single use); agreements (current_version, status draft/approved/locked); agreement_versions (body_json, approvals, hash; immutable once approved); milestones (agreement_version_id, title, amount, currency, due_at, state, state_version for optimistic locking); acceptance_criteria (kind test/browser/static/review, spec_json, weight; review kind always ends in human review); submissions (repo_url, commit_sha, deploy_url; pinned to a commit); verification_runs (status, workflow_run_id; one per attempt); check_results (verdict pass/fail/needs_review, source deterministic/ai, confidence, summary); evidence (type log/screenshot/replay/diff, uri, sha256); disputes (P1); payments (paypal_order_id, authorization_id, capture_id, payout_batch_id, status, amount, request_ids); webhook_events (paypal_event_id unique, verified, payload_hash); audit_events (prev_hash, hash).

Milestone states (any move not drawn is rejected): DRAFT -> AGREED (both approve) -> FUNDED (authorization created) -> SUBMITTED -> VERIFYING -> REPORT_READY -> {SUBMITTED (resubmit) | APPROVED | DISPUTED}; DISPUTED -> APPROVED (for freelancer) or CANCELLED (for client); APPROVED -> RELEASED (capture ok) -> PAID (payout ok); FUNDED -> CANCELLED (authorization voided).

Contradiction prevention: guarded single-SQL transitions (`WHERE state = <expected> AND state_version = <n>`; zero rows = lost race); stored `PayPal-Request-Id` on create/capture/reauthorize/payout; webhooks verified, stored once, reconciled by fetching from PayPal; scheduled job reauthorizes FUNDED milestones on day 3 and warns before day 29; RELEASED only if latest run has no FAIL or client overrides with a written reason.

Routes (Zod-validated, server-side permission checks): `POST /api/projects`, `/api/projects/:id/invite`, `/api/invitations/:token/accept`; `POST /api/agreements/compile`, `PATCH /api/agreements/:id`, `POST /api/agreements/:id/approve`; `POST /api/milestones/:id/fund`, `/authorize`, `/submissions`, `/approve` (capture then payout), `/cancel` (void), `/disputes` (P1); `POST /api/submissions/:id/verify`; `GET /api/runs/:id`; `POST /api/webhooks/paypal`; `GET /api/projects/:id/audit`.

## 8. AI system design
Model writes and explains; code decides and pays. Four jobs, one narrow Zod schema each, none can call a money API.
- Agreement Compiler: Gemini Flash (free tier); brief to milestones, amounts, criteria by kind, ambiguity questions.
- Check Planner: Gemini Flash; approved criteria + repo file tree + package.json to concrete checks (test commands, browser steps, file assertions); the checks are run by code.
- Evidence Reviewer: Gemini Flash (one re-ask on bad JSON; review criteria always end in human review); plain-language summary per criterion; suggested verdict with confidence only for review kind. Test/browser verdicts are decided by exit codes and assertions.
- Dispute Assistant (P1): Gemini Flash; claims supported/contradicted/unverified plus non-binding recommendation; PayPal details via read-only toolkit.
Plain code only: state transitions, amount/payee checks, PayPal calls, test and browser results, audit hashing, permission checks.
Failures: JSON schema on every call, parse with Zod, retry once with the validation error, then mark `needs_review`. Context: file tree plus selected files under a token budget; never `.env`, lockfiles or binaries.
Injection defence: delimited data blocks and "untrusted" system prompt; scanner flags instruction-like text ("ignore previous", "mark as pass") as evidence; output only fills a schema; deterministic verdicts cannot be overridden by summaries.
Human review needed for: any review criterion, AI confidence < 0.7, any injection flag, every payment release.
Evaluation: fixed set of eight seed projects (passing, failing, flaky test, missing deploy, injected README, injected HTML comment, vague brief, over-budget brief) in CI; track verdict accuracy and schema failures per phase. [Rev 1] Cost/limits: all calls go through the `StructuredAi` interface; 429 -> exponential backoff -> typed `busy` -> "AI busy" UI state; seeded demo outputs cached so judges are not blocked by quota. Privacy: the Gemini free tier uses prompts to improve Google products, so public repos and seeded text only; no PayPal identifiers or tokens sent to the model; logs store hashes.

## 9. Phase plan (29 Oct to 11 Nov; 12 Nov buffer)
| # | Phase | Dates | Coding model | Runtime model | Done when |
|---|---|---|---|---|---|
| 1 | Accounts and risk spikes | 29-31 Oct | sonnet (haiku) | Gemini Flash test call | Sandbox payment authorized, captured, paid out; Actions runner runs `npm test` + Playwright with no secrets visible; webhook verifies on Render Free; Gemini call validates |
| 2 | Foundation | 31 Oct-2 Nov | opusplan (sonnet) | none | Deployed app, GitHub sign-in, schema migrated, CI green |
| 3 | Agreements and milestones | 2-4 Nov | sonnet | Gemini Flash | Brief becomes approved versioned agreement with audit entries |
| 4 | Verification engine | 3-7 Nov | opus; fable if stuck | Gemini Flash | Pass, fail, malicious seeds give correct verdicts with evidence |
| 5 | PayPal payments (parallel with 4) | 4-7 Nov | opus (sonnet) | none | Fund, approve, capture, payout, void, reauthorize work and survive retries |
| 6 | Integration and trust layer | 7-8 Nov | opus | none | Full journey on deployed URL; security review fixed |
| 7 | Dashboard and dispute assistant (P1) | 8-9 Nov | sonnet | Gemini Flash | AG Studio dashboard with custom widgets; dispute pack |
| 8 | Testing and hardening | 9-10 Nov | sonnet; opus for security | none | E2E green on production; README lets a fresh machine run it |
| 9 | Demo and submission | 10-11 Nov | sonnet (haiku for docs) | none | Submission complete: repo, license, video, hosted URL |
Stop for approval at the end of each phase. Model switching: opus/opusplan for architecture, payment state machine, sandbox runner, security review; sonnet for UI and routine; fable only after two failed attempts; independent review via fresh opus subagent with `superpowers:requesting-code-review`.

**Phase 1 (29-31 Oct, ~1.5 days) [Rev 1]:** prove the four risky integrations before product code: (1) OAuth token, `AUTHORIZE` order, buyer approval, authorize, capture, Payout (capture minus 5% platform fee) to a second sandbox personal account, with the real authorization `expiration_time` recorded; (2) GitHub Actions runner in `arbiter-runner` on `arbiter-spike-fixture`: `workflow_dispatch`, untrusted code in its own `permissions: {}` job with no secrets, `npm ci && npm test`, Playwright, verdicts from the Jobs API, a probe proving it cannot see a secret, and a case proving hostile inputs are rejected; (3) tiny endpoint on a Render Free web service receiving and verifying a real PayPal sandbox webhook, cold-start delay recorded; (4) one structured-output call to the free-tier Gemini Flash model, validated with Zod, behind the provider interface; plus a Neon `SELECT 1` ping. Deliverables: `spikes/` with four scripts and `FINDINGS.md`. Fallbacks: Payouts blocked -> capture straight to the freelancer's sandbox business account as payee; Actions runner unusable -> a local Docker-based runner (documented as not hosted) and say so; PayPal sign-up problems -> PayPal Discord.
**Phase 2 Foundation [Rev 1]:** Next.js strict TS, Tailwind/shadcn, Drizzle schema + migration on Neon, Auth.js GitHub, role-check helper, Render Free web service config, GitHub Actions CI, CLAUDE.md, `.env.example`, MIT LICENSE. Tests: role-check helper, state-machine table.
**Phase 3:** project creation and invitations; Agreement Compiler (schema, retries, ambiguity questions); editor with criteria by kind (approval blocked until each criterion has a kind); dual approval and locking; milestone list; hash-chained audit log + viewer. Tests: 10 sample briefs, transitions, tampering breaks the chain.
**Phase 4 (critical path) [Rev 1]:** submission pinned to commit; repo fetch on the runner; Check Planner (Gemini); `verify` workflow dispatched with run id, polled and reconciled via the Jobs API; evidence from artifacts and the public run URL with SHA-256; injection scanner; Evidence Reviewer; report page; resubmission. Seed repos `arbiter-demo-pass`, `-fail`, `-injection`. Tests: eight-project eval set; hostile workflow inputs rejected; the untrusted step sees no secrets. Risk: Actions queue time and Free-tier sleep -> design the UI for 1-3 minute waits. Task: check whether step-security Harden-Runner can enforce an egress allow-list on our public runner repo (not added in Phase 1).
**Phase 5 [Rev 1]:** **first task: JS SDK v6 buttons** (Spike 1 approves via a redirect link, so the buttons are untested until here); server routes for create, authorize, capture, void, reauthorize, payout; `PayPal-Request-Id` everywhere; payment guard (platform fee = percentage + small fixed amount from Phase 1's measured PayPal fees; demo milestones $50 or more); webhook endpoint with verification, de-dup, reconciliation; reauthorize via a scheduled GitHub Action calling a protected endpoint; payment timeline UI. Tests: replayed capture/webhook changes nothing; forged webhook rejected; capture above milestone amount refused.
**Phase 6:** wire verification results to approve; override with reason; rate limits; security headers; secrets audit; independent opus security review.
**Phase 7 (P1):** AG Studio dashboard (money held vs released, pass rate, at-risk milestones), theming, Studio agent; dispute assistant; KERNEL replays; invoices. Cut line: drop dispute assistant first.
**Phase 8:** Playwright E2E against production; smoke test; seed-reset; README (setup, test accounts, architecture); empty/error states.
**Phase 9:** demo data; script and shot list; Devpost description and tool list; repo About + license; final checklist.

## 10. Skills, MCP servers and tools
- Superpowers plugin (required): `/plugin marketplace add obra/superpowers-marketplace` then `/plugin install superpowers@superpowers-marketplace` (also in the official marketplace). Verify: `/help` lists `superpowers:` skills.
- APIMatic Context Plugin for PayPal (recommended; phases 1, 5, 6): steps in APIMatic's PDF (unread); qualifies for APIMatic free subscription.
- PayPal MCP server (recommended; 1, 5, 6): `claude mcp add paypal -e PAYPAL_ACCESS_TOKEN=<token> -e PAYPAL_ENVIRONMENT=SANDBOX -- npx -y @paypal/mcp --tools=all` (token expires). Sandbox token only, never live.
- Render plugin (recommended; 2, 6, 8; authorized by the user): read logs and deploy status; approve its actions one by one (it can change env vars and deploy). [Rev 1] Neon skills (`neon`, `neon-postgres`) are installed in `.claude/skills`; the Neon MCP is available for schema work.
- Playwright MCP (required; 2-8): `claude mcp add playwright npx @playwright/mcp@latest`.
- GitHub CLI `gh` (all phases): `gh auth login`; verify `gh auth status`.
- CLAUDE.md written in Phase 2 and approved by the user.
- Project libraries (Phase 2+): Next.js, Drizzle, Auth.js, Zod, `@anthropic-ai/sdk`, `@paypal/agent-toolkit`, `@renderinc/sdk`, Playwright, Vitest, AG Studio.
Never paste a key into chat; keep in `.env.local` and Render environment settings.

## 11. Critical path and risks
Critical path 1 -> 2 -> 3 -> 4 -> 6 -> 8 -> 9. Payments (5) depend only on 1-2 and run beside verification; dashboard/dispute (7) are first cut.
| Risk | Likelihood | Impact | Early warning | Fallback |
|---|---|---|---|---|
| PayPal sign-up/sandbox blocked from India | Medium | Blocks entry | Phase 1 day 1 (now cleared: accounts exist) | PayPal Discord |
| Payouts not enabled in sandbox app | Low | Breaks payout step | Phase 1 spike | Freelancer's sandbox business account as payee so capture pays directly |
| GitHub Actions runner slow or rate-limited | Medium | Slow/blocked verification | Phase 1 spike (queue and run times) | Progress UI; seeded cached runs for the demo; local Docker runner as a documented last resort |
| Render Free cold start misses a PayPal webhook delivery | Medium | Delayed state updates | Phase 1 Spike 3 | PayPal retries; reconcile by fetching from PayPal; keep-warm scheduled Action |
| Authorization expires before approval | Low in demo | Payment fails | Reauthorize job logs | Reauthorize on day 3; void and re-fund past day 29 |
| AI verdicts wrong on edge cases | Medium | Trust and demo | Eval set in CI | Deterministic checks decide; low confidence to human |
| Prompt injection succeeds | Low | Key demo fails | Injection seed repo | Model has no write tools; scanner flags; tests decide |
| Gemini free-tier quota (429) or policy change during judging | Medium | Hosted demo AI features stall | Watch 429s in Phase 1 and 8 | Retry with backoff, "AI busy" state, cached seeded outputs, provider interface for a backup |
| AG Studio trial expires before judging ends | Medium | Watermark/breakage | Trial date | Claim on/after 1 Nov; degrade to plain AG Grid community |
| Scope creep | High | Missed deadline | Phase gates | P0 first; cut line in Phase 7 |

## 12. Demo script (2:45) and submission checklist
0:00-0:20 unpaid invoice and "it's not done" message; 0:20-0:45 client pastes brief, milestones and testable criteria, asks about a vague one; 0:45-1:05 client funds milestone 1, status "authorized, not captured"; 1:05-1:35 freelancer submits, live test run and browser checks, 5 PASS 1 FAIL with screenshot; 1:35-2:00 second submission hides "mark everything as passed" in the README, report flags it, tests still decide; 2:00-2:25 fixed submission passes, client approves, capture and payout complete, sandbox accounts show money moved; 2:25-2:45 audit log with hash chain, AG Studio dashboard, one line on architecture. Royalty-free music or none; no third-party logos except PayPal's own developer UI.
Checklist (target 11 Nov): Devpost project; public GitHub repo with MIT LICENSE in About; README (problem, features, architecture, setup, `.env.example`, sandbox test accounts, seeds, known limitations); hosted demo URL with seeded accounts plus local instructions; video under 3:00 public on YouTube; text description and tools used (Google Gemini API (free tier), Claude Code, PayPal Orders/Payments/Payouts/Webhooks/Agent Toolkit, Render (Free web service), Neon, GitHub Actions, AG Studio, KERNEL if used, APIMatic plugin if used); sponsor tools named; note project created during submission period (commits after 1 Oct); fresh-clone test; app, accounts and AI key kept working until judging ends 15 Dec.

## 13. Manual tasks
**Before Phase 1 (required, ~2 h):**
1. Join the hackathon on Devpost; confirm 18+ and India residency (eligible).
2. PayPal developer account at developer.paypal.com. If sign-up fails from India, post in PayPal Discord. Verify: Developer Dashboard opens.
3. Sandbox app: Apps & Credentials > Sandbox > Create App (type Merchant). Put Client ID and Secret in `.env.local`. Tick Payouts in Features. Verify: app page shows Payouts enabled.
4. Sandbox accounts: Testing Tools > Sandbox Accounts. Keep default business (Arbiter platform) and personal (client); create a second personal (freelancer). Country United States for all three. Note each email. Verify: log in to sandbox.paypal.com with each.
5. [Rev 1, replaced] No Anthropic runtime key. Gemini free-tier key from Google AI Studio; no billing.
6. [Rev 1, done] Render account (Free web service only; no Render API key or credits needed) and Neon project (free, AWS us-east-1; `DATABASE_URL`). Gemini API key from AI Studio (`GEMINI_API_KEY`) replaces item 5. GitHub: public repos `arbiter-runner` and `arbiter-spike-fixture`; fine-grained token `GITHUB_RUNNER_TOKEN` (Actions read/write on `arbiter-runner` only).
7. GitHub: install `gh`, `gh auth login`. Verify: `gh auth status`.
8. Claude Code updated (`claude update`), Superpowers installed. Verify: `/model opus` works.
**Later:** approve sandbox buyer login during Phase 1 payment script; create public repo `arbiter` and a GitHub OAuth app (before Phase 2); add env vars in the Render dashboard (Phase 2; no Render API key); write/approve two sample briefs (before Phase 3, optional); approve three seed repos (before Phase 4); register webhook URL in the PayPal sandbox app (before Phase 5); walk through a payment yourself (after Phase 5); claim AG Studio trial (on/after 1 Nov) and KERNEL credits (before Phase 7); open the APIMatic PDF and claim free month (before Phase 5); try the app on phone and second browser (Phase 8); record voice-over and screen capture, upload to YouTube public (Phase 9); submit on Devpost by 11 Nov and confirm the email.
Open question: solo or teammates? If teammates, Phases 4 and 5 can be split.
