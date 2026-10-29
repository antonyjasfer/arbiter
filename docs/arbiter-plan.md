# Arbiter: Phase 0 Plan (approved, 29 Oct 2026)

> Provenance: transcribed on 2026-10-29 from `Arbiter - Phase 0 Plan.pdf` (26 pages) because `docs/arbiter-plan.md` did not exist in the folder. Tables are condensed; source link text in the PDF could not be recovered as URLs. Where the PDF's table layout was ambiguous it is noted. The PDF remains the original.

## 0. Lead's corrections and warnings
1. **Deadline** is 01:30 IST Fri 13 Nov (12:00 pm PST Thu 12 Nov = 20:00 UTC; US clocks fall back 1 Nov). Plan to submit 11 Nov, keep a day of buffer, about 13 working days.
2. **PayPal cannot hold money for a whole project.** Authorization valid 29 days, funds guaranteed only for a 3-day honor period. Fund one milestone at a time just before work; reauthorize if needed. Say this plainly; do not call it escrow.
3. **Platform money flow.** Client pays Arbiter's sandbox business account; on approval Arbiter captures then sends a Payout to the freelancer. Payouts works in sandbox once enabled for the app. Live use needs PayPal platform programme and approvals (disclosed limitation).
4. **The AI never moves money.** Payment calls are deterministic server code, after human approval, within agreed amount and payee. (Mandate lives inside Arbiter.)
5. **P0 verifies GitHub repos and deployed websites only.** Documents, designs, full dispute assistant are P1.
6. **AG Grid prize = AG Studio** (dashboard): custom widgets, theming, Studio Agent Framework. 45-day free trial from claim; judging ends 15 Dec, so claim on or after 1 Nov.
7. **Day-1 account checks:** (a) PayPal testing outside the US needs a Business account and sign-up varies by country; (b) Anthropic API key with prepaid credit, billed separately from Claude subscription; (c) Render Sandboxes is in public beta.
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
| Render | $50 credits; prize favours Render Workflows | Verified |
| Render Workflows | TS/Python task functions, one instance per run, retries, runs up to 24 h | Verified (beta) |
| Render Sandboxes | Isolated environments for untrusted code, configurable outbound network (or none); public beta; no public URLs yet | Verified |
| KERNEL | Cloud browsers with live view and replay; $50 credits; no cash prize | Verified (Playwright connection to check) |
| APIMatic | Context Plugin gives Claude Code PayPal API context; setup in linked PDF | Verified (install steps unread) |
| Runtime models | `claude-sonnet-5-5` $2/$10, `claude-haiku-5-5` from $0.10/$0.50, `claude-opus-5-5` $4/$20 per M tokens; 1M context | Verified |
| Claude Code models | `/model opus|sonnet|haiku|fable|opusplan`; `claude --model <alias>` | Verified |
Hands-on checks still needed (Phase 1): sandbox payout lands; webhook reaches deployed URL and verifies; Render Sandbox clones public repo and runs `npm test` with network limited to GitHub/npm; KERNEL accepts a Playwright connection.

## 3. Hackathon strategy
Aim: Grand Prize; fallback Best Use of Agentic Commerce or Best Use of PayPal + AI; plus one sponsor prize (AG Grid first, Render second). Criteria are equal weight; Technological Implementation is the first tie-breaker.
- Tech: Orders authorize/capture/reauthorize/void, Payouts, verified webhooks, idempotent state machine, AI agreement compiler, sandboxed test runner, real browser checks.
- Design: two real roles, one coherent flow brief to payout, evidence viewer, AG Studio trust dashboard.
- Impact: fixed-price freelance software work; payment tied to evidence both sides agreed.
- Innovation: escrow sites exist; evidence-driven verification with bounded AI payment authority does not.
- Presentation: one story: a pass, a fail, a manipulation attempt caught, then a real sandbox payout.
- **Strongest demo moment:** a hidden line in the freelancer's repo tells the AI to mark every criterion passed; tests still fail, report flags the injection, no money moves.
- Build because they raise scores: reauthorization, webhook verification, audit log, injection test, AG Studio widgets, Render Workflows. Cut: subjective design review, document/Figma deliverables in core, multi-currency, chat interface over everything, more than one AI agent per job.
- Could stop submission: PayPal sign-up from India; Payouts enabled in sandbox; Anthropic credit; Render Sandboxes behaving as documented.

## 4. Scope
P0 (full loop for code and websites; nothing else starts until it works end to end on the deployed app): GitHub sign-in, roles, invitations; AI Agreement Compiler with ambiguity flags, dual approval, versioning; milestones; submission of repo+commit+deploy URL; verification (Render Sandbox tests, browser checks, per-criterion verdicts with evidence); PayPal authorize per milestone, capture on approval, void on cancel, reauthorize after 3 days, Payout; verified webhooks and idempotent state machine; payment guard (amount, payee, human approval) and prompt-injection detection; hash-chained audit log; seeded demo projects (passing, failing, malicious).
P1: AG Studio trust dashboard (custom widgets, Studio agent); dispute assistant; KERNEL sessions with replay; invoices via Invoicing API.
P2: revision rounds and partial captures; document deliverables; Zapier notifications. Out: design/Figma judgments; live payments, real escrow, multi-currency, KYC; non-Node projects (Node and static sites only).

## 5. Architecture
One web app holds all business logic and is the only component that can call PayPal money-moving endpoints; verification runs in separate isolated workers.
1. Client signs in with GitHub, pastes brief; app asks Claude for structured agreement; approved version stored in Postgres.
2. Funding: browser shows PayPal buttons; on buyer approval server authorizes the order and stores authorization id.
3. On submission app starts the `verifySubmission` Render Workflow: fetch repo at pinned commit, ask Claude for check plan, fan out: tests in a Render Sandbox (network only GitHub and npm), browser checks via Playwright (or KERNEL) against the deployed site.
4. Results, logs, screenshots hashed and written to Postgres and storage; Claude writes plain-language summary.
5. On client approval, payment guard checks amount, payee, approver and verdicts, then captures and sends Payout. PayPal webhooks return to a verified endpoint and are reconciled.
6. Every step appends a hash-chained audit event.
Security boundaries: browser to app (session cookie, server-side role checks); app to PayPal/Anthropic (secrets only on server); app to workers (signed task inputs, no PayPal secrets in workers); workers to untrusted code (sandbox, network allow-list, 5-minute limit, no secrets inside). Logs: Render logs with request ids; no tokens, card data or emails.

## 6. Technology stack
TypeScript strict everywhere; Next.js App Router (server actions, route handlers); Tailwind + shadcn/ui; AG Studio (React) from the PayPal boilerplate (45-day trial); Render Postgres + Drizzle; Auth.js with GitHub OAuth; Zod at every boundary incl. AI output; PayPal REST Orders v2 / Payments v2 / Payouts v1 / Webhooks v1 from the server plus JS SDK v6 buttons; `@paypal/agent-toolkit` with read-only tools in dispute assistant; Anthropic API (`claude-sonnet-5-5`, `claude-haiku-5-5`) via TS SDK with structured outputs (est. under $10 for the build); Render Workflows (TS SDK); Render Sandboxes with network limited to GitHub and npm (fallback E2B); Playwright for browser checks, KERNEL for replays (P1); Render web service + workflow + Postgres via `render.yaml`; Vitest + Playwright Test. Hardest parts: sandbox runner and payment state machine, both spiked in Phase 1.

## 7. Data model and application design
Sixteen tables: users (id, github_id, name, email, paypal_email [sandbox, freelancers]); projects; project_members (role); invitations (token_hash, expires_at, single use); agreements (current_version, status draft/approved/locked); agreement_versions (body_json, approvals, hash; immutable once approved); milestones (agreement_version_id, title, amount, currency, due_at, state, state_version for optimistic locking); acceptance_criteria (kind test/browser/static/review, spec_json, weight; review kind always ends in human review); submissions (repo_url, commit_sha, deploy_url; pinned to a commit); verification_runs (status, workflow_run_id; one per attempt); check_results (verdict pass/fail/needs_review, source deterministic/ai, confidence, summary); evidence (type log/screenshot/replay/diff, uri, sha256); disputes (P1); payments (paypal_order_id, authorization_id, capture_id, payout_batch_id, status, amount, request_ids); webhook_events (paypal_event_id unique, verified, payload_hash); audit_events (prev_hash, hash).

Milestone states (any move not drawn is rejected): DRAFT -> AGREED (both approve) -> FUNDED (authorization created) -> SUBMITTED -> VERIFYING -> REPORT_READY -> {SUBMITTED (resubmit) | APPROVED | DISPUTED}; DISPUTED -> APPROVED (for freelancer) or CANCELLED (for client); APPROVED -> RELEASED (capture ok) -> PAID (payout ok); FUNDED -> CANCELLED (authorization voided).

Contradiction prevention: guarded single-SQL transitions (`WHERE state = <expected> AND state_version = <n>`; zero rows = lost race); stored `PayPal-Request-Id` on create/capture/reauthorize/payout; webhooks verified, stored once, reconciled by fetching from PayPal; scheduled job reauthorizes FUNDED milestones on day 3 and warns before day 29; RELEASED only if latest run has no FAIL or client overrides with a written reason.

Routes (Zod-validated, server-side permission checks): `POST /api/projects`, `/api/projects/:id/invite`, `/api/invitations/:token/accept`; `POST /api/agreements/compile`, `PATCH /api/agreements/:id`, `POST /api/agreements/:id/approve`; `POST /api/milestones/:id/fund`, `/authorize`, `/submissions`, `/approve` (capture then payout), `/cancel` (void), `/disputes` (P1); `POST /api/submissions/:id/verify`; `GET /api/runs/:id`; `POST /api/webhooks/paypal`; `GET /api/projects/:id/audit`.

## 8. AI system design
Model writes and explains; code decides and pays. Four jobs, one narrow Zod schema each, none can call a money API.
- Agreement Compiler: `claude-sonnet-5-5`; brief to milestones, amounts, criteria by kind, ambiguity questions.
- Check Planner: `claude-sonnet-5-5`; approved criteria + repo file tree + package.json to concrete checks (test commands, browser steps, file assertions); the checks are run by code.
- Evidence Reviewer: `claude-haiku-5-5`, escalate to Sonnet for review criteria; plain-language summary per criterion; suggested verdict with confidence only for review kind. Test/browser verdicts are decided by exit codes and assertions.
- Dispute Assistant (P1): `claude-sonnet-5-5` (Opus 5.5 optional); claims supported/contradicted/unverified plus non-binding recommendation; PayPal details via read-only toolkit.
Plain code only: state transitions, amount/payee checks, PayPal calls, test and browser results, audit hashing, permission checks.
Failures: JSON schema on every call, parse with Zod, retry once with the validation error, then mark `needs_review`. Context: file tree plus selected files under a token budget; never `.env`, lockfiles or binaries.
Injection defence: delimited data blocks and "untrusted" system prompt; scanner flags instruction-like text ("ignore previous", "mark as pass") as evidence; output only fills a schema; deterministic verdicts cannot be overridden by summaries.
Human review needed for: any review criterion, AI confidence < 0.7, any injection flag, every payment release.
Evaluation: fixed set of eight seed projects (passing, failing, flaky test, missing deploy, injected README, injected HTML comment, vague brief, over-budget brief) in CI; track verdict accuracy and schema failures per phase. Privacy: public repos only; no PayPal identifiers or tokens sent to the model; logs store hashes.

## 9. Phase plan (29 Oct to 11 Nov; 12 Nov buffer)
| # | Phase | Dates | Coding model | Runtime model | Done when |
|---|---|---|---|---|---|
| 1 | Accounts and risk spikes | 29-31 Oct | sonnet (haiku) | claude-haiku-5-5 test call | Sandbox payment authorized, captured, paid out; sandbox runs `npm test`; webhook verifies |
| 2 | Foundation | 31 Oct-2 Nov | opusplan (sonnet) | none | Deployed app, GitHub sign-in, schema migrated, CI green |
| 3 | Agreements and milestones | 2-4 Nov | sonnet | sonnet-5-5 | Brief becomes approved versioned agreement with audit entries |
| 4 | Verification engine | 3-7 Nov | opus; fable if stuck | sonnet-5-5, haiku-5-5 | Pass, fail, malicious seeds give correct verdicts with evidence |
| 5 | PayPal payments (parallel with 4) | 4-7 Nov | opus (sonnet) | none | Fund, approve, capture, payout, void, reauthorize work and survive retries |
| 6 | Integration and trust layer | 7-8 Nov | opus | none | Full journey on deployed URL; security review fixed |
| 7 | Dashboard and dispute assistant (P1) | 8-9 Nov | sonnet | sonnet-5-5 | AG Studio dashboard with custom widgets; dispute pack |
| 8 | Testing and hardening | 9-10 Nov | sonnet; opus for security | none | E2E green on production; README lets a fresh machine run it |
| 9 | Demo and submission | 10-11 Nov | sonnet (haiku for docs) | none | Submission complete: repo, license, video, hosted URL |
Stop for approval at the end of each phase. Model switching: opus/opusplan for architecture, payment state machine, sandbox runner, security review; sonnet for UI and routine; fable only after two failed attempts; independent review via fresh opus subagent with `superpowers:requesting-code-review`.

**Phase 1 (29-31 Oct, ~1.5 days):** prove the four risky integrations before product code: (1) OAuth token, `AUTHORIZE` order, buyer approval, authorize, capture, Payout to a second sandbox personal account; (2) Render Sandbox with network limited to GitHub/npm, clone public repo, `npm ci && npm test`, exit code; (3) tiny deployed endpoint receiving and verifying a PayPal sandbox webhook; (4) one structured-output call to `claude-haiku-5-5`. Deliverables: `spikes/` with four scripts and a findings note. Fallbacks: Payouts blocked -> capture straight to the freelancer's sandbox business account as payee; Render Sandboxes failing -> E2B; PayPal sign-up from India failing -> PayPal Discord immediately.
**Phase 2 Foundation:** Next.js strict TS, Tailwind/shadcn, Drizzle schema + migration, Auth.js GitHub, role-check helper, `render.yaml`, GitHub Actions CI, CLAUDE.md, `.env.example`, MIT LICENSE. Tests: role-check helper, state-machine table.
**Phase 3:** project creation and invitations; Agreement Compiler (schema, retries, ambiguity questions); editor with criteria by kind (approval blocked until each criterion has a kind); dual approval and locking; milestone list; hash-chained audit log + viewer. Tests: 10 sample briefs, transitions, tampering breaks the chain.
**Phase 4 (critical path):** submission pinned to commit; repo fetch via GitHub API; Check Planner; Workflow task `verifySubmission` fanning out to `runTests` (Sandbox) and `runBrowserChecks` (Playwright); evidence upload with SHA-256; injection scanner; Evidence Reviewer; report page; resubmission. Seed repos `arbiter-demo-pass`, `-fail`, `-injection`. Tests: eight-project eval set; sandbox cannot reach hosts outside allow-list. Risk: slow runs -> snapshots, 5-minute limit.
**Phase 5:** JS SDK v6 buttons; server routes for create, authorize, capture, void, reauthorize, payout; `PayPal-Request-Id` everywhere; payment guard; webhook endpoint with verification, de-dup, reconciliation; reauthorize cron; payment timeline UI. Tests: replayed capture/webhook changes nothing; forged webhook rejected; capture above milestone amount refused.
**Phase 6:** wire verification results to approve; override with reason; rate limits; security headers; secrets audit; independent opus security review.
**Phase 7 (P1):** AG Studio dashboard (money held vs released, pass rate, at-risk milestones), theming, Studio agent; dispute assistant; KERNEL replays; invoices. Cut line: drop dispute assistant first.
**Phase 8:** Playwright E2E against production; smoke test; seed-reset; README (setup, test accounts, architecture); empty/error states.
**Phase 9:** demo data; script and shot list; Devpost description and tool list; repo About + license; final checklist.

## 10. Skills, MCP servers and tools
- Superpowers plugin (required): `/plugin marketplace add obra/superpowers-marketplace` then `/plugin install superpowers@superpowers-marketplace` (also in the official marketplace). Verify: `/help` lists `superpowers:` skills.
- APIMatic Context Plugin for PayPal (recommended; phases 1, 5, 6): steps in APIMatic's PDF (unread); qualifies for APIMatic free subscription.
- PayPal MCP server (recommended; 1, 5, 6): `claude mcp add paypal -e PAYPAL_ACCESS_TOKEN=<token> -e PAYPAL_ENVIRONMENT=SANDBOX -- npx -y @paypal/mcp --tools=all` (token expires). Sandbox token only, never live.
- Render plugin (recommended; 2, 6, 8): `/plugin install render@claude-plugins-official`, then `/reload-plugins`. Approve its actions one by one (it can change env vars and deploy).
- Playwright MCP (required; 2-8): `claude mcp add playwright npx @playwright/mcp@latest`.
- GitHub CLI `gh` (all phases): `gh auth login`; verify `gh auth status`.
- CLAUDE.md written in Phase 2 and approved by the user.
- Project libraries (Phase 2+): Next.js, Drizzle, Auth.js, Zod, `@anthropic-ai/sdk`, `@paypal/agent-toolkit`, `@renderinc/sdk`, Playwright, Vitest, AG Studio.
Never paste a key into chat; keep in `.env.local` and Render environment settings.

## 11. Critical path and risks
Critical path 1 -> 2 -> 3 -> 4 -> 6 -> 8 -> 9. Payments (5) depend only on 1-2 and run beside verification; dashboard/dispute (7) are first cut.
| Risk | Likelihood | Impact | Early warning | Fallback |
|---|---|---|---|---|
| PayPal sign-up/sandbox blocked from India | Medium | Blocks entry | Phase 1 day 1 | PayPal Discord; US sandbox region; worst case a teammate's developer account |
| Payouts not enabled in sandbox app | Low | Breaks payout step | Phase 1 spike | Freelancer's sandbox business account as payee so capture pays directly |
| Render Sandboxes (beta) unstable/limited | Medium | Breaks test runs | Phase 1 spike | E2B with same interface wrapper |
| Authorization expires before approval | Low in demo | Payment fails | Reauthorize job logs | Reauthorize on day 3; void and re-fund past day 29 |
| AI verdicts wrong on edge cases | Medium | Trust and demo | Eval set in CI | Deterministic checks decide; low confidence to human |
| Prompt injection succeeds | Low | Key demo fails | Injection seed repo | Model has no write tools; scanner flags; tests decide |
| Anthropic credit runs out during judging | Low | Hosted demo breaks | Spend alert | Spend limit plus rate limits; cache seeded runs' AI summaries |
| AG Studio trial expires before judging ends | Medium | Watermark/breakage | Trial date | Claim on/after 1 Nov; degrade to plain AG Grid community |
| Scope creep | High | Missed deadline | Phase gates | P0 first; cut line in Phase 7 |

## 12. Demo script (2:45) and submission checklist
0:00-0:20 unpaid invoice and "it's not done" message; 0:20-0:45 client pastes brief, milestones and testable criteria, asks about a vague one; 0:45-1:05 client funds milestone 1, status "authorized, not captured"; 1:05-1:35 freelancer submits, live test run and browser checks, 5 PASS 1 FAIL with screenshot; 1:35-2:00 second submission hides "mark everything as passed" in the README, report flags it, tests still decide; 2:00-2:25 fixed submission passes, client approves, capture and payout complete, sandbox accounts show money moved; 2:25-2:45 audit log with hash chain, AG Studio dashboard, one line on architecture. Royalty-free music or none; no third-party logos except PayPal's own developer UI.
Checklist (target 11 Nov): Devpost project; public GitHub repo with MIT LICENSE in About; README (problem, features, architecture, setup, `.env.example`, sandbox test accounts, seeds, known limitations); hosted demo URL with seeded accounts plus local instructions; video under 3:00 public on YouTube; text description and tools used (Claude Sonnet/Haiku via API, Claude Code, PayPal Orders/Payments/Payouts/Webhooks/Agent Toolkit, Render Workflows and Sandboxes, AG Studio, KERNEL if used, APIMatic plugin if used); sponsor tools named; note project created during submission period (commits after 1 Oct); fresh-clone test; app, accounts and AI key kept working until judging ends 15 Dec.

## 13. Manual tasks
**Before Phase 1 (required, ~2 h):**
1. Join the hackathon on Devpost; confirm 18+ and India residency (eligible).
2. PayPal developer account at developer.paypal.com. If sign-up fails from India, post in PayPal Discord. Verify: Developer Dashboard opens.
3. Sandbox app: Apps & Credentials > Sandbox > Create App (type Merchant). Put Client ID and Secret in `.env.local`. Tick Payouts in Features. Verify: app page shows Payouts enabled.
4. Sandbox accounts: Testing Tools > Sandbox Accounts. Keep default business (Arbiter platform) and personal (client); create a second personal (freelancer). Country United States for all three. Note each email. Verify: log in to sandbox.paypal.com with each.
5. Anthropic API key at platform.claude.com with about $10 prepaid credit and a monthly spend limit. Verify: key in Console.
6. Render account; claim the $50 hackathon credits; create an API key; note workspace ID. Verify: credits in Billing.
7. GitHub: install `gh`, `gh auth login`. Verify: `gh auth status`.
8. Claude Code updated (`claude update`), Superpowers installed. Verify: `/model opus` works.
**Later:** approve sandbox buyer login during Phase 1 payment script; create public repo `arbiter` and a GitHub OAuth app (before Phase 2); add Render API key and env vars (Phase 2); write/approve two sample briefs (before Phase 3, optional); approve three seed repos (before Phase 4); register webhook URL in the PayPal sandbox app (before Phase 5); walk through a payment yourself (after Phase 5); claim AG Studio trial (on/after 1 Nov) and KERNEL credits (before Phase 7); open the APIMatic PDF and claim free month (before Phase 5); try the app on phone and second browser (Phase 8); record voice-over and screen capture, upload to YouTube public (Phase 9); submit on Devpost by 11 Nov and confirm the email.
Open question: solo or teammates? If teammates, Phases 4 and 5 can be split.
