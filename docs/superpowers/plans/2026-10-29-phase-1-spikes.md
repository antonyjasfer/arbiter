# Phase 1: Accounts and Risk Spikes (zero-budget revision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision:** 3 (29 Oct 2026, approved by the user). Adds four pre-run requirements (job-level `permissions: {}`, untrusted code in its own secret-free job with the canary in a separate job, a malicious-input rejection case, real capture and payout fees) and includes the Neon ping. Revision 2 replaced revision 1, which assumed Anthropic and Render Sandboxes. The user has **zero budget: no paid services of any kind.**

**Goal:** Prove the four risky integrations (PayPal authorize/capture/payout, untrusted tests + Playwright on a GitHub Actions runner, PayPal webhook signature verification on a Render Free web service, Gemini free-tier structured output) work before any product code exists.

**Architecture:** Four independent, throwaway spikes in `spikes/`, sharing a tiny `lib/` (env, PayPal client, GitHub client, AI provider interface). Two deployable units: `spikes/runner/` (published to the public repo `arbiter-runner`) and `spikes/03-webhook/` (deployed to Render Free). Results go in `spikes/FINDINGS.md`. No product code, no Next.js, no Drizzle.

**Tech Stack:** Node 18+ (recommend latest 24.x LTS), TypeScript strict, `tsx`, Vitest (helpers only), `zod` (v4, for `z.toJSONSchema`), `@google/genai`, `fflate` (unzip artifacts), `pg` (Neon ping), PayPal REST and GitHub REST via `fetch` (no vendor SDKs for them, so we control `PayPal-Request-Id`).

**Spec:** `docs/arbiter-plan.md` (Revision 1 section, section 9 Phase 1, section 11 fallbacks, section 13 manual tasks); rules in `CLAUDE.md`.

## Global Constraints

- **No paid services.** Render Free web service (Virginia) only; Neon free Postgres; GitHub Actions on a public repo (free); Gemini free tier. No Render Workflows, Sandboxes, paid Postgres or Render API key. If anything asks for a card or billing, stop and report.
- Phase 1 only: no application scaffolding, no Drizzle/Auth.js/Next.js. `spikes/` is labelled throwaway.
- Never print, log or commit secret values. Env check reports variable **names** only. `.env.local` and `spikes/.out/` are git-ignored.
- Env var names (all already in `.env.local`): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT` (must equal `SANDBOX`; scripts refuse otherwise), `PAYPAL_FREELANCER_EMAIL`, `PAYPAL_WEBHOOK_ID` (**empty until Task 5 step 4**; only Task 5 needs it), `GEMINI_API_KEY`, `DATABASE_URL` (not used by Tasks 1-6), `GITHUB_RUNNER_TOKEN` (fine-grained, Actions read/write on `RUNNER_REPO` only), `RUNNER_REPO` (`owner/arbiter-runner`), `FIXTURE_REPO_URL`. Optional new name: `AI_MODEL` (Gemini model id; defaults to the id recorded in Task 6).
- PayPal sandbox host only: `https://api-m.sandbox.paypal.com`. Every PayPal **write** sends a fresh `PayPal-Request-Id` (UUID v4), stored in the run summary.
- GitHub REST calls send `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`.
- Runner rules (production runner holds **no secrets at all**): untrusted code runs in its **own job** that has `permissions: {}` and no `secrets.*` reference; the `SPIKE_CANARY` secret lives only in a **separate** job; workflow inputs are **never** interpolated with `${{ inputs.* }}` inside `run:` steps, they are passed through `env:` and validated first (github.com repo URL, 40-char hex SHA, https deploy URL, numeric run id); `timeout-minutes: 10`; public repos only.
- Gemini rules: model id comes from the pricing page row marked "Free of charge" (checked 29 Oct 2026: `gemini-3.8-flash`, listed Stable); record the id and the free-tier limits in FINDINGS; **free-tier content is used to improve Google products**, so send only public repo content and seeded demo text, never PayPal data or personal data.
- Deadline context: Phase 1 runs 29-31 Oct 2026; submission closes 01:30 IST 13 Nov.
- Coding model: `/model sonnet` for every task. A fresh opus subagent reviews `spikes/runner/` (Task 4) with `superpowers:requesting-code-review` before it is published. `fable` only after two failed debugging attempts on one problem.

## Review Focus

1. **Missing or blank env var:** exits code 2 listing missing variable names only, never values, before any network call (`PAYPAL_WEBHOOK_ID` is only required by Task 5).
2. **Buyer abandons or cancels at PayPal:** script waits up to 5 minutes, then exits non-zero printing the order id; it must not authorize or capture.
3. **Payout `PENDING`/`UNCLAIMED`/`FAILED`:** poll max 2 minutes, print the real status, exit non-zero unless succeeded; never report PASS on a pending payout.
4. **Webhook body re-serialization:** the verify request embeds the received body byte-for-byte; a parsed-and-restringified body must not be sent.
5. **Hostile workflow inputs:** `repo_url` with shell metacharacters or a non-`github.com` host, a `commit_sha` that is not 40 hex chars, a non-https `deploy_url`, or a non-numeric `run_id` must fail the `validate` job, and `tests` and `browser` must then be `skipped`; the `reject` spike case proves it with a real dispatch.
6. **Dispatch cannot be matched to a run, or the run hangs/queues:** the script times out, reports `INFRA_TIMEOUT` with the dispatch time and `run-name`, and never reports PASS.
7. **Gemini 429 or invalid JSON:** 429 retries with backoff then returns a typed `busy` result (the "AI busy" state); invalid JSON gets exactly one re-ask then returns `invalid_output`; neither crashes on `null`.

---

## File Structure

```
spikes/
  package.json                     # type: module, scripts, deps
  tsconfig.json                    # strict
  FINDINGS.md                      # Task 7
  lib/env.ts            lib/env.test.ts
  lib/paypal.ts         lib/paypal.test.ts
  lib/approval-server.ts           # local redirect catcher for buyer approval
  lib/github.ts         lib/github.test.ts      # Task 4
  lib/ai.ts             lib/ai.test.ts          # Task 6: provider interface, validation retry, 429 retry, cache
  lib/ai-gemini.ts                               # Task 6: the only file that imports @google/genai
  01-paypal.ts                     # Spike 1 (Task 2)
  02-runner.ts                     # Spike 2 (Task 4)
  runner/                          # published to the public repo arbiter-runner (Task 4)
    .github/workflows/verify.yml
    checks/browser.mjs  package.json  README.md
  fixtures/node-fixture/           # published as arbiter-spike-fixture, branches pass / fail / probe (Task 3)
  03-webhook/{package.json,server.ts,verify.ts,verify.test.ts}   # Task 5, deployed to Render Free
  04-gemini.ts                     # Spike 4 (Task 6)
  05-neon-ping.ts                  # Spike 5 (Task 7), runs SELECT 1 against DATABASE_URL
```

---

### Task 1: Spike workspace and shared helpers

**Files:**
- Create: `spikes/package.json`, `spikes/tsconfig.json`, `spikes/lib/env.ts`, `spikes/lib/paypal.ts`, `spikes/lib/approval-server.ts`
- Test: `spikes/lib/env.test.ts`, `spikes/lib/paypal.test.ts`

**Interfaces:**
- Produces:
  - `requireEnv(names: string[], source?: Record<string, string | undefined>): Record<string, string>`: when `source` is omitted, loads the repo-root `.env.local` (parse `KEY=VALUE` lines, ignore comments/blank lines, strip optional surrounding quotes, never log). Throws `MissingEnvError` whose message lists missing **names only**; blank string counts as missing. Exits are the caller's job.
  - `newRequestId(): string` (UUID v4).
  - `getAccessToken(env: {PAYPAL_CLIENT_ID: string; PAYPAL_CLIENT_SECRET: string; PAYPAL_ENVIRONMENT: string}): Promise<string>`: rejects (no network call) unless `PAYPAL_ENVIRONMENT === "SANDBOX"`.
  - `ppFetch<T>(token: string, method: "GET" | "POST", path: string, opts?: { body?: unknown; requestId?: string }): Promise<{ status: number; body: T; requestId?: string }>`: base URL `https://api-m.sandbox.paypal.com`; sets `PayPal-Request-Id` when `requestId` given; throws `PayPalError` (status, `PayPal-Debug-Id`, body name/message) on non-2xx.
  - `waitForApproval(port: number, timeoutMs: number): Promise<{ token: string; payerId: string }>`: serves `http://localhost:<port>`, resolves on `/return?token=...&PayerID=...`, rejects on `/cancel` or timeout; always closes the server.

- [ ] **Step 1: Write failing tests.** `env.test.ts`: `requireEnv(["A","B"], {A:"x"})` throws and the message contains `B` and does not contain `x`; a blank string counts as missing. `paypal.test.ts`: `newRequestId()` matches the UUID v4 regex and two calls differ; `getAccessToken` rejects with a message containing `SANDBOX` when `PAYPAL_ENVIRONMENT` is `LIVE`, with `globalThis.fetch` replaced by a function that fails the test if called.
- [ ] **Step 2: Run** `cd spikes && npx vitest run lib` → FAIL (modules missing).
- [ ] **Step 3: Create `package.json`** (`"type": "module"`; scripts `spike:paypal`, `spike:runner`, `spike:gemini`, `spike:neon`, `test`; deps `zod`, `@google/genai`, `fflate`, `pg`; dev deps `tsx`, `typescript`, `vitest`, `@types/node`, `@types/pg`) and strict `tsconfig.json`; `npm install` inside `spikes/` (spike dependencies only; this is Phase 1 execution, not Phase 0).
- [ ] **Step 4: Implement** `lib/env.ts`, `lib/paypal.ts` (OAuth: `POST /v1/oauth2/token`, Basic auth, `grant_type=client_credentials`), `lib/approval-server.ts` per Interfaces.
- [ ] **Step 5: Run** `npx vitest run lib` → PASS; `npx tsc --noEmit` → no errors.
- [ ] **Step 6: Commit** `chore(spikes): workspace and shared PayPal/env helpers`

---

### Task 2: Spike 1, PayPal authorize, capture, payout (flow unchanged; $50 amount; real fees recorded)

**Files:**
- Create: `spikes/01-paypal.ts`

**Interfaces:**
- Consumes: `requireEnv`, `getAccessToken`, `ppFetch`, `newRequestId`, `waitForApproval` (Task 1).
- Produces: `spikes/.out/paypal-run.json` (ids, statuses, request ids; git-ignored). CLI: `npm run spike:paypal` (main flow); `-- --probe` (void + reauthorize probe flow).

**Main flow** (each PayPal write has its own `PayPal-Request-Id`):
1. `POST /v2/checkout/orders`: `intent: "AUTHORIZE"`, one `purchase_units[0]` with `amount {currency_code:"USD", value:"50.00"}`, `payment_source.paypal.experience_context {user_action:"PAY_NOW", shipping_preference:"NO_SHIPPING", return_url:"http://localhost:3456/return", cancel_url:"http://localhost:3456/cancel"}`. Expect `PAYER_ACTION_REQUIRED`; print the link with `rel: "payer-action"`.
2. `waitForApproval(3456, 300000)`.
3. `POST /v2/checkout/orders/{id}/authorize` → read `purchase_units[0].payments.authorizations[0]` (`id`, `status`, **`expiration_time`: print and record the real value, and the number of days from now**).
4. `POST /v2/payments/authorizations/{authId}/capture` body `{amount {USD 50.00}, final_capture: true}` → capture id, status `COMPLETED`; record `seller_receivable_breakdown` (`gross_amount`, `paypal_fee`, `net_amount`).
5. Idempotency replay: repeat step 4 with the **same** request id; record whether the same capture id returns or an error.
6. `POST /v1/payments/payouts` with `sender_batch_header {sender_batch_id: "spike1-<timestamp>", email_subject}`, one item `{recipient_type:"EMAIL", receiver: PAYPAL_FREELANCER_EMAIL, amount {USD 47.50}, sender_item_id}`. **47.50 = capture 50.00 minus a 5% Arbiter platform fee (2.50).** Demo milestones are $50 or more, so the main flow uses $50.00; the Phase 5 fee will be a percentage plus a small fixed amount. Poll `GET /v1/payments/payouts/{batch_id}` every 5 s up to 120 s; record `batch_header.fees` if present.
7. Print a summary table: order id, auth id + expiration, capture id, payout batch id, item `transaction_status`, all request ids. **Fees (required):** print the **real capture fee** from the capture's `seller_receivable_breakdown` (`gross_amount`, `paypal_fee`, `net_amount`, plus `paypal_fee / gross` as a percentage and the implied fixed part), and the **real payout fee** from the payout batch (`batch_header.fees`) and the item (`payout_item_fee`) once the batch reaches a terminal status. Print a fee-coverage line `net_amount - 47.50 - payout_fee`; a negative value means the 5% platform fee does not cover PayPal's costs. Save all of it in `paypal-run.json` and record **both fees** in FINDINGS.md.

**`--probe` flow:** new $5.00 AUTHORIZE order, second buyer approval, authorize, `POST /v2/payments/authorizations/{id}/reauthorize` (record status/error verbatim; expected to be rejected inside the 3-day honor period), then `POST .../void` (expect 204).

- [ ] **Step 1: Hand step (you, before running):** confirm Payouts is ticked on the sandbox app and you have the **client** sandbox personal login ready (passwords stay in the PayPal dashboard).
- [ ] **Step 2: Implement** `01-paypal.ts` per the flow: on any failure print `PayPalError` fields (status, debug id, name, message) and exit 1; on abandoned approval exit 1 without authorizing.
- [ ] **Step 3: Run** `npm run spike:paypal`. When the URL prints, open it in a private window, log in as the **client** sandbox personal account, approve.
  Expected: ends with `RESULT: PASS`; statuses `AUTHORIZATION CREATED`, `CAPTURE COMPLETED`, payout item `SUCCESS`; replay shows the same capture id; the real `expiration_time` is printed.
- [ ] **Step 4: Verify by hand:** in sandbox.paypal.com, the freelancer account shows +47.50 USD and the business account shows the capture.
- [ ] **Step 5: Run** `npm run spike:paypal -- --probe`; approve once more; record the reauthorize response and void result.
- [ ] **Step 6: Commit** `spike(paypal): authorize, capture, payout, probe flows`

**Pass:** all of steps 3-4 plus void 204. **Fallback (plan section 11):** if Payouts is blocked or the item fails for account reasons, set the freelancer's **business** sandbox account as `payee.email_address` on the order so the capture pays them directly, and record that Payouts was unavailable. If PayPal blocks the account: ask in the PayPal Discord immediately. **Model:** sonnet.

---

### Task 3: Fixture repo for Spike 2

**Files:**
- Create: `spikes/fixtures/node-fixture/{package.json,package-lock.json,index.js,test/index.test.js,README.md}`

**Interfaces:**
- Produces: a public GitHub repo `arbiter-spike-fixture` (already referenced by `FIXTURE_REPO_URL`) with three branches: `pass` (tests exit 0), `fail` (one deliberately false assertion, exit non-zero), `probe` (as `pass`, plus `test/no-secrets.test.js`: asserts `process.env.SPIKE_CANARY` is undefined, that `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `GITHUB_TOKEN` are undefined, and that no env var **name** matches `/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i`; it prints matching names only, never values).

- [ ] **Step 1: Create the fixture** so `npm test` runs `node --test`, with one real dependency (`ms`) imported by `index.js` so `npm ci` must reach `registry.npmjs.org`, and a lockfile (`npm install --package-lock-only`).
- [ ] **Step 2: Run locally** `cd spikes/fixtures/node-fixture && npm ci && npm test` → exit 0; then check the `fail` and `probe` variants locally (`probe` passes locally because the canary is absent).
- [ ] **Step 3: Hand step (you):** push the three branches to `arbiter-spike-fixture` (this publishes to your public repo, so I show the exact commands and wait for your yes). Verify `FIXTURE_REPO_URL` matches.
- [ ] **Step 4: Commit** `spike(fixture): tiny node project with pass, fail and probe variants`

**Pass:** three branches visible on GitHub; `fail` exits non-zero locally. **Model:** sonnet.

---

### Task 4: Spike 2, GitHub Actions runner on the fixture repo

**Files:**
- Create: `spikes/runner/.github/workflows/verify.yml`, `spikes/runner/checks/browser.mjs`, `spikes/runner/package.json`, `spikes/runner/README.md`, `spikes/lib/github.ts`, `spikes/02-runner.ts`
- Test: `spikes/lib/github.test.ts`

**Design decisions (record in FINDINGS):**
- The workflow lives in the public repo `arbiter-runner` on its **default branch** (required for `workflow_dispatch`). `name: verify`, file `verify.yml`, `run-name: verify ${{ inputs.run_id }}` so a dispatch can be matched to its run even if the dispatch response carries no run id.
- `on.workflow_dispatch.inputs` (all strings, required): `repo_url`, `commit_sha`, `run_id`, plus `deploy_url` (added to your three inputs because the Playwright checks need a target; for the spike use `https://example.com`).
- `permissions: {}` at workflow level **and** on every job (a job that needs more must say so explicitly; none do); the runner repo is **not** checked out, so no `.git` credentials exist on any VM.
- Jobs: `validate` (regex-checks inputs; **inputs are only read through `env:`, never `${{ inputs.* }}` inside `run:`**: `repo_url` must match `^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, `commit_sha` `^[0-9a-f]{40}$`, `run_id` `^[0-9]{1,18}$`, `deploy_url` `^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$`); then three more jobs: `tests` (needs `validate`; **untrusted code only**), `browser` (needs `validate`) and `canary-holder` (needs `validate`; the **only** job that references `secrets.SPIKE_CANARY`, prints just the character count to prove the secret exists in this repo, and runs no repo code). `tests` and `browser` never reference `secrets.*`. Separate jobs run on separate VMs, so the untrusted job cannot see the canary even by accident; the probe checks the untrusted job's environment for credential-shaped names and tokens.
- `tests` job (`permissions: {}`, no secrets, `timeout-minutes: 10`) steps, named exactly: `fetch` (`git init`, `git fetch --depth 1 "$REPO_URL" "$COMMIT_SHA"`, `git checkout FETCH_HEAD`, with `REPO_URL` and `COMMIT_SHA` coming from `env:`), `install` (`env -i PATH="$PATH" HOME="$HOME" npm ci`), `unit-tests` (`env -i ... npm test`). The untrusted steps run under `env -i` so they inherit no workflow environment.
- `browser` job (`permissions: {}`, no secrets, `timeout-minutes: 10`): install Playwright Chromium, run `checks/browser.mjs "$DEPLOY_URL"` (asserts HTTP 200 and a non-empty `<title>`, saves `screenshot.png`).
- **Verdict source of truth = GitHub's Jobs API** (`GET /repos/{o}/{r}/actions/runs/{id}/jobs`: job and step `conclusion`), not the artifact, because untrusted test code can write files on the VM but cannot change GitHub's recorded step conclusions. The artifact (`logs`: `test.log`, `screenshot.png`) is display evidence. The public run URL (`html_url`) is the evidence link.
- Known honest limit: **GitHub-hosted runners have open internet egress**; there is no GitHub/npm allow-list. Mitigations: no secrets, ephemeral VM, 10-minute timeout, public repos only. CLAUDE.md rule 4 and the README say so.

**Interfaces (`spikes/lib/github.ts`):**
- `parseRepoUrl(url: string): { owner: string; repo: string }`: accepts `https://github.com/o/r` with optional `.git`, throws on any other host or extra characters.
- `validateVerifyInputs(i: { repoUrl: string; commitSha: string; runId: string; deployUrl: string }): string[]`: returns a list of problems (empty when valid) using the **same regexes** as the workflow's `validate` job; `dispatchVerify` refuses locally when the list is non-empty (defence in depth) unless `opts.skipLocalValidation` is true, which only the `reject` spike case uses.
- `matchRunByTitle(runs: {id: number; display_title: string; created_at: string}[], runId: string, notBefore: Date): number | undefined`: id of the newest run whose `display_title === "verify " + runId` created at or after `notBefore`.
- `ghFetch<T>(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T; headers: Headers }>`: throws `GitHubError` (status, message) on non-2xx other than 302; uses `redirect: "manual"`.
- `dispatchVerify(env: {GITHUB_RUNNER_TOKEN: string; RUNNER_REPO: string}, input: { repoUrl: string; commitSha: string; runId: string; deployUrl: string }, opts?: { skipLocalValidation?: boolean }): Promise<{ ghRunId: number }>`: `POST /repos/{RUNNER_REPO}/actions/workflows/verify.yml/dispatches` with `{ref: "main", inputs}`; uses `workflow_run_id` from the response when present (the docs say the endpoint returns `200` with it; **assumed until the spike runs**), otherwise lists `GET .../actions/workflows/verify.yml/runs?event=workflow_dispatch` and calls `matchRunByTitle` for up to 60 s.
- `waitForRun(env, ghRunId: number, timeoutMs: number): Promise<{ status: string; conclusion: string | null; htmlUrl: string; jobs: { name: string; conclusion: string | null; steps: { name: string; conclusion: string | null }[] }[] }>`: polls every 5 s.
- `downloadArtifactFiles(env, ghRunId: number): Promise<Record<string, Uint8Array>>`: lists run artifacts, downloads the zip following the 302 `Location` **without** the `Authorization` header, unzips with `fflate`.
- CLI: `npm run spike:runner -- <pass|fail|probe|reject>` resolves that branch's SHA via `GET /repos/{fixture}/commits/{branch}` (`reject` uses the `pass` SHA but sends hostile inputs), dispatches with a numeric run id (`Date.now()`), waits, prints verdicts from the Jobs API, queue time, run time, artifact file names, and the public run URL.

- [ ] **Step 1: Write failing tests** `github.test.ts`: `parseRepoUrl("https://github.com/a/b.git")` → `{owner:"a", repo:"b"}`; `parseRepoUrl("https://evil.com/a/b")` and `"https://github.com/a/b; rm -rf /"` throw; `matchRunByTitle` ignores runs older than `notBefore`, ignores a different `run_id`, and returns the newest match; `validateVerifyInputs` returns `[]` for a valid set and reports a problem for each of: repo URL `https://github.com/a/b;touch x`, repo URL on `gitlab.com`, SHA `abc123`, SHA with uppercase or 41 chars, `http://` deploy URL, deploy URL containing a space, run id `12ab`, run id `1; echo`, run id longer than 18 digits.
- [ ] **Step 2: Run** `npx vitest run lib/github` → FAIL; **implement** `parseRepoUrl` and `matchRunByTitle` → PASS.
- [ ] **Step 3: Write `spikes/runner/`** per the design decisions (workflow, `checks/browser.mjs`, `package.json` with `playwright` as the one dependency, README stating the egress limit). Lint the YAML with `actionlint` if available; otherwise read it twice against Review Focus item 5.
- [ ] **Step 4: Review:** dispatch a fresh opus subagent with `superpowers:requesting-code-review` on `spikes/runner/` only, focused on injection through inputs, secret exposure and token permissions. Fix findings.
- [ ] **Step 5: Hand steps (you):** (a) add a repository secret `SPIKE_CANARY` (any random dummy string, not a real credential) to `arbiter-runner`; (b) I show the exact `git push` into `arbiter-runner` and wait for your yes before running it (it publishes to your public repo); (c) confirm `GITHUB_RUNNER_TOKEN` is fine-grained with Actions read/write on `arbiter-runner` only.
- [ ] **Step 6: Implement** `ghFetch`, `dispatchVerify`, `waitForRun`, `downloadArtifactFiles` and `02-runner.ts`.
- [ ] **Step 7: Run** `npm run spike:runner -- pass`. Expected: `validate`, `tests`, `browser` and `canary-holder` `success`; `canary-holder` prints a non-zero length; `install` and `unit-tests` `success`.
- [ ] **Step 8: Run** `npm run spike:runner -- fail`. Expected: dispatch succeeds, `unit-tests` step `failure`, `tests` job `failure`, `browser` and `canary-holder` `success`. The script treats this detected failure as the expected verdict, so it ends `RESULT: PASS`.
- [ ] **Step 9: Run** `npm run spike:runner -- probe`. Expected: `canary-holder` `success` with a non-zero length (the secret exists in the repo), and `tests` (which includes `no-secrets.test.js`) `success`, proving the untrusted job could not see it or any token. Open the run's public log and confirm no secret value appears.
- [ ] **Step 9b: Run** `npm run spike:runner -- reject` (malicious inputs, local validation skipped). Send four dispatches, one per hostile field: `repo_url=https://github.com/a/b;touch /tmp/pwned`, `commit_sha=HEAD;id`, `deploy_url=http://example.com`, `run_id=1;id`. For each, expected: `validate` `failure`, `tests`, `browser` and `canary-holder` `skipped`, and no step output shows the injected command executed. The script prints `RESULT: PASS` only when all four are rejected this way.
- [ ] **Step 10: Commit** `spike(runner): github actions runner, jobs-api verdicts, secret probe`

**Pass:** pass branch all green; fail branch gives `unit-tests` failure read from the Jobs API; probe proves no secrets in the untrusted job; **all four hostile-input dispatches rejected by `validate` with nothing else run**; artifact downloaded; whether the dispatch response returned a run id recorded; queue + run wall time recorded (target under 4 minutes). **Fallbacks:** if dispatch returns `204` with no run id, rely on `run-name` matching (already implemented); if the fine-grained token cannot download artifacts, record it and use the Jobs API plus the public log URL only (artifacts are optional evidence); if Playwright install is too slow, cache with `actions/cache` or use the runner's preinstalled browsers; if queue times are bad, record them and design the UI for a 1-3 minute wait. **Model:** sonnet; opus reviews.

---

### Task 5: Spike 3, webhook endpoint with signature verification on Render Free

**Files:**
- Create: `spikes/03-webhook/package.json`, `spikes/03-webhook/server.ts`, `spikes/03-webhook/verify.ts`
- Test: `spikes/03-webhook/verify.test.ts`

**Interfaces:**
- Produces: `buildVerifyBody(headers: Record<string, string | undefined>, rawBody: string, webhookId: string): string`: returns the JSON **string** for `POST /v1/notifications/verify-webhook-signature` with fields `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `paypal-*` headers, case-insensitive), `webhook_id`, and `webhook_event` set to `rawBody` embedded verbatim. Throws if a required header is missing.
- Server: `GET /health` → 200 `{"ok":true}`; `POST /webhook` → reads the raw body, returns **503** `webhook_id not configured` if `PAYPAL_WEBHOOK_ID` is unset (so the first deploy can happen before the webhook exists), otherwise builds the body, calls PayPal with an OAuth token, returns 200 only when `verification_status === "SUCCESS"`, else 400. Logs only: event id, event type, verification status, and seconds since process start (to expose cold starts). No payloads, no headers.

- [ ] **Step 1: Write failing test** `verify.test.ts`: raw body `{"id":"WH-1","note":"héllo  ☃","a":1}` (double spaces and unicode) appears **byte-identical** inside the returned string at `"webhook_event":<raw>`; missing `paypal-transmission-sig` throws.
- [ ] **Step 2: Run** `npx vitest run 03-webhook` → FAIL; **implement** `buildVerifyBody` by string concatenation for `webhook_event` (never `JSON.stringify` the parsed event) → PASS.
- [ ] **Step 3: Implement `server.ts`** with `node:http`, port from `process.env.PORT`; copy the ~20-line OAuth logic into this folder (the deployable unit must not import `../lib`). `package.json`: `"start": "tsx server.ts"`, with `tsx` and `typescript` in **dependencies** (Render production installs skip devDependencies).
- [ ] **Step 4: Hand steps (you), in this order:**
  1. Push the repo to GitHub as `arbiter` (public, MIT) when ready; Render deploys from GitHub. I show the exact commands and wait for your yes.
  2. Render dashboard → New → Web Service → connect `arbiter` → **Instance type: Free**, **Region: Virginia (US East)**, **Root Directory: `spikes/03-webhook`**, Build Command `npm ci`, Start Command `npm start`.
  3. In Render → the service → **Environment**, add exactly these variables (type the values in the dashboard yourself, not in chat):
     - `PAYPAL_CLIENT_ID`
     - `PAYPAL_CLIENT_SECRET`
     - `PAYPAL_ENVIRONMENT` = `SANDBOX`
     - `PAYPAL_WEBHOOK_ID`: **leave unset on this first deploy**; set it in sub-step 5.
  4. PayPal sandbox app → Webhooks → Add Webhook → URL `https://<your-service>.onrender.com/webhook` → select events by name: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `CHECKOUT.ORDER.APPROVED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` (if a name is missing from the list, tell me the closest names) → Save → copy the **Webhook ID**.
  5. Put the Webhook ID into `.env.local` as `PAYPAL_WEBHOOK_ID` **and** into Render's Environment as `PAYPAL_WEBHOOK_ID`; Render redeploys.
- [ ] **Step 5: Cold-start measurement:** wait at least 16 minutes with no traffic, then `curl -s -o /dev/null -w "%{time_total}\n" https://<service>.onrender.com/health` and record the seconds. (Docs: Free web services spin down after 15 minutes idle and take about a minute to wake.)
- [ ] **Step 6: Negative case:** `curl -i -X POST https://<service>.onrender.com/webhook -H "paypal-transmission-id: x" -d '{}'` (forged) → HTTP 400 (503 before the ID is set); the log shows non-`SUCCESS`.
- [ ] **Step 7: Positive case after an idle spell:** let the service sleep (16+ min), then re-run `npm run spike:paypal` (Task 2). Record in FINDINGS: (a) whether PayPal's first delivery arrived while the service was waking, (b) whether a retry appears in the sandbox webhook events list (the dashboard shows delivery attempts), (c) logs show `type=PAYMENT.CAPTURE.COMPLETED verification=SUCCESS`. The dashboard's "simulate event" sends **mock** events that postback verification cannot verify; use real events only.
- [ ] **Step 8: Commit** `spike(webhook): paypal webhook receiver with signature verification`

**Pass:** forged request rejected; at least one real event verified `SUCCESS` on the deployed URL; cold-start seconds recorded. **Fallbacks:** if verification fails repeatedly, record the failing headers' **names** only and ask in the PayPal Discord or verify the certificate chain manually per PayPal docs; if PayPal's delivery times out on cold start, plan Phase 5 around PayPal's retries plus a GitHub Actions scheduled keep-warm ping (free; 750 instance hours per month covers one always-on service, since a 31-day month is 744 hours); if Render deployment fails, use a tunnel for the spike and record that Render hosting is unproven. **Model:** sonnet.

---

### Task 6: Spike 4, Gemini free-tier structured output behind a provider interface

**Files:**
- Create: `spikes/lib/ai.ts`, `spikes/lib/ai-gemini.ts`, `spikes/04-gemini.ts`
- Test: `spikes/lib/ai.test.ts`

**Interfaces (`spikes/lib/ai.ts`; product code later moves this file as-is):**
- `type AiSuccess<T> = { ok: true; data: T; model: string; cached: boolean; usage: { inputTokens: number; outputTokens: number } }`
- `type AiFailure = { ok: false; reason: "busy" | "refused" | "invalid_output" | "error"; detail: string; retryAfterMs?: number }`
- `interface StructuredAi { readonly model: string; generate<T>(req: { system: string; prompt: string; schema: z.ZodType<T>; schemaName: string }): Promise<AiSuccess<T> | AiFailure> }`
- `class AiHttpError extends Error { status: number; retryAfterMs?: number }`: thrown by raw callers.
- `type RawJsonCall = (req: { system: string; prompt: string; jsonSchema: object }) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>`
- `createStructuredAi(raw: RawJsonCall, model: string): StructuredAi`: builds `jsonSchema` with `z.toJSONSchema(schema)` **minus the `$schema` key**; runs `JSON.parse(text)` then `schema.parse`; on a parse or Zod failure re-asks **exactly once** with the validation error appended to the prompt; then returns `invalid_output`. A raw `AiHttpError{status:429}` becomes `{reason:"busy"}` carrying `retryAfterMs`. Never throws.
- `withRetry429(ai: StructuredAi, opts?: { maxAttempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> }): StructuredAi`: when the inner call returns `{reason:"busy"}`, waits `retryAfterMs` if given else `baseMs * 2^attempt` (plus jitter), up to `maxAttempts` (default 3), then returns the last `busy` failure. Other failures are returned immediately.
- `withCache(ai: StructuredAi, store: { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void> }): StructuredAi`: key = sha256 of `model + system + prompt + schemaName`; a hit is re-validated with the schema and returned as `{ok:true, cached:true}`; only successes are stored.
- `createGeminiRaw(apiKey: string, model: string): RawJsonCall` in `ai-gemini.ts` (the **only** file importing `@google/genai`); maps HTTP 429 / `RESOURCE_EXHAUSTED` to `AiHttpError{status:429}`.

- [ ] **Step 1: Write failing tests** in `ai.test.ts` using a fake `RawJsonCall`: (a) valid JSON → `ok:true, cached:false`; (b) first reply invalid JSON, second valid → ok, raw caller called exactly twice, the second prompt contains the validation error; (c) two invalid replies → `reason:"invalid_output"` and exactly two calls; (d) raw caller throws `AiHttpError{status:429}` every time, with injected `sleep` → `reason:"busy"`, three attempts, `sleep` received increasing delays (or `retryAfterMs` when given); (e) a non-429 error is not retried; (f) `withCache`: a second identical call returns `cached:true` and the inner caller ran once; a failure is never cached; (g) the generated JSON schema has no `$schema` key.
- [ ] **Step 2: Run** `npx vitest run lib/ai` → FAIL; **implement** `ai.ts` → PASS.
- [ ] **Step 3: Implement `ai-gemini.ts`.** The current Gemini docs (checked 29 Oct 2026) show the TS quickstart as `new GoogleGenAI({})` reading `GEMINI_API_KEY`, and structured output as `client.interactions.create({ model, input, response_format: { type: "text", mime_type: "application/json", schema } })` with the reply in `interaction.output_text`. Implement that first. **Assumed (not verified):** the older `ai.models.generateContent({ model, contents, config: { responseMimeType: "application/json", responseJsonSchema } })` path also still works; if `interactions.create` is rejected at runtime, switch to it and record which one worked. The API ignores `minLength`/`maxLength`/`uniqueItems` and similar keywords, so keep schemas simple and rely on Zod.
- [ ] **Step 4: Implement `04-gemini.ts`:** the same `AgreementSketch` Zod schema as before (milestones with `title`, `amount_usd`, `criteria[{text, kind: "test"|"browser"|"static"|"review", testable}]`, plus `ambiguity_questions: string[]`; no `.min()/.max()`), a short sample brief containing one vague phrase ("make it fast"), model from `AI_MODEL` or the default `gemini-3.8-flash`. Compose `withCache(withRetry429(createStructuredAi(createGeminiRaw(...))), fileStore)` with a file store in `spikes/.out/ai-cache/`. Call it twice: the first is live, the second must come from the cache. Also fetch the model's metadata once and print the token limits it reports. On `busy` print `AI busy: retry later` and exit 3 (a finding, not a crash).
- [ ] **Step 5: Hand step (you):** open AI Studio → the rate-limit page for your project and send me the **free-tier numbers for the chosen model (requests/min, tokens/min, requests/day)**; they are not secrets. The public docs page does not list them. Also re-open the pricing page and confirm the row still says "Free of charge" for input and output.
- [ ] **Step 6: Run** `npm run spike:gemini`. Expected: parsed milestones, at least one `ambiguity_questions` entry, usage tokens, `cached:false` then `cached:true`, `RESULT: PASS`.
- [ ] **Step 7: Commit** `spike(ai): gemini free-tier structured output behind a provider interface`

**Pass:** valid parse within the single allowed re-ask, cache hit on the second call, model id and limits recorded. **Fallbacks:** if the preferred model is unavailable or not free, take the next Flash row marked "Free of charge" (`gemini-3.6-flash`, then `gemini-2.5-flash`); if structured output errors on one API surface, use the other (Step 3); a second provider later implements `RawJsonCall` without touching callers. **Model:** sonnet.

---

### Task 7: Findings note, optional Neon ping, and phase gate

**Files:**
- Create: `spikes/FINDINGS.md`
- Create: `spikes/05-neon-ping.ts`

- [ ] **Step 1: Implement `05-neon-ping.ts`** (included at your request): uses `DATABASE_URL`, runs `SELECT 1` twice (the first when the compute may have suspended, the second warm) with the `pg` driver, prints both latencies and the server version, never prints the connection string, exits non-zero on failure. Purpose: prove the Phase 2 database path under the free plan (docs: computes suspend after 5 minutes idle). Run it once right after a 6+ minute idle gap to capture a real cold start.
- [ ] **Step 2: Create `spikes/FINDINGS.md`** with this template, filled from real runs (ids, statuses and numbers only, no secrets):

```markdown
# Phase 1 Findings (YYYY-MM-DD)

| Spike | Result (PASS / PARTIAL / FAIL) | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | | |
| 2 GitHub Actions runner | | |
| 3 Webhook verify (Render Free) | | |
| 4 Gemini structured output | | |
| 5 Neon ping | | |

## 1 PayPal
- Order / authorization / capture / payout batch ids:
- Authorization `expiration_time` seen (US sandbox; docs conflict on 3 vs 29 days):
- Replay with same PayPal-Request-Id returned:
- Capture: gross / **real PayPal capture fee** / net, fee % and implied fixed part (amount $50.00); payout $47.50 (5% platform fee): **real payout fee** (batch + item), fee-coverage result:
- Reauthorize probe response (verbatim error name):
- Void result:
- Surprises / API differences from docs:

## 2 GitHub Actions runner
- Dispatch response: run id returned (y/n), status code:
- Queue time / run time (pass, fail, probe):
- Jobs API conclusions for pass / fail / probe (are step conclusions usable as verdicts):
- Secret probe: canary visible in its own step (length), invisible to untrusted step (y/n), public log clean (y/n):
- Artifact download with the fine-grained token (y/n); redirect handled without auth header (y/n):
- Open egress confirmed (arbitrary host reachable from a test):
- Playwright install time, browser check result:
- Docs vs behaviour:

## 3 Webhook (Render Free, Virginia)
- Verified event types seen:
- Forged request response:
- Cold-start seconds after 16+ idle minutes:
- PayPal first delivery during wake-up (y/n), retry observed (y/n):
- Webhook ID handling (unset on first deploy -> 503 -> set -> redeploy):

## 4 Gemini
- Model id chosen; pricing row said "Free of charge" (y/n); date checked:
- Free-tier limits from AI Studio (RPM / TPM / RPD):
- Which API surface worked (interactions.create / generateContent):
- Parsed first try (y/n), re-ask used (y/n), schema keywords ignored by the API:
- Tokens in/out; 429 seen (y/n):
- Cache hit on second call (y/n):
- Free tier trains on prompts (docs: yes): what we will never send:

## 5 Neon
- Cold-start latency (after 6+ idle minutes) / warm latency:
- Server version, region:

## Decisions for Phase 2
- Keep / change from the plan:
- Fallbacks invoked:
- Open risks carried forward:
```

- [ ] **Step 3: Run the full check:** `cd spikes && npx vitest run && npx tsc --noEmit` → all pass (read the real output before claiming it).
- [ ] **Step 4: Commit** `docs(spikes): phase 1 findings`
- [ ] **Step 5: Stop.** Report PASS/PARTIAL/FAIL per spike and wait for your approval before Phase 2.

---

## Self-review

- **Spec coverage (your 7 points):** (1) env names checked, `PAYPAL_WEBHOOK_ID` empty on purpose and gated to Task 5; (2) Render Free only, Virginia, no Workflows/Sandboxes/API key (Task 5); (3) Neon via `DATABASE_URL` (optional ping now, Phase 2 for real); (4) GitHub Actions runner with `workflow_dispatch`, `GITHUB_RUNNER_TOKEN`, inputs repo URL / SHA / run id, `npm ci`, `npm test`, Playwright, no secrets, artifact + polling + public run logs (Task 4); (5) Gemini free tier behind a Zod-driven provider interface, cache, 429 retry with an "AI busy" state, model id and limits to FINDINGS (Task 6); (6) your flag decisions: real webhook events (Task 5 step 7), `PAYPAL_WEBHOOK_ID` (Task 5), real `expiration_time` (Task 2 step 3), 5% platform fee (Task 2 steps 6-7), JS SDK v6 buttons as the first Phase 5 task (plan doc); (7) revised spikes 1-4 (Tasks 2, 4, 5, 6).
- **Added beyond your list (flagged, now approved):** a fourth workflow input `deploy_url`; a `probe` fixture branch and a separate canary job so the "cannot see any secret" check is not vacuous; a `reject` spike case for hostile inputs; verdicts read from GitHub's Jobs API; the Neon ping.
- **Open assumptions to confirm at run time (not verified by running):** the dispatch response returns `workflow_run_id`; the fine-grained token can list/download artifacts; Jobs API step conclusions are usable; Playwright Chromium installs within the 10-minute limit; `gemini-3.8-flash` is genuinely free in AI Studio and `interactions.create` accepts the schema; free-tier numeric limits; the listed PayPal webhook event names exist; the Render Free instance wakes fast enough for PayPal's first delivery.
- **Type consistency:** `requireEnv`, `ppFetch`, `ghFetch`, `StructuredAi`, `RawJsonCall` and `AiHttpError` are defined once and used by name in later tasks.
- **Not covered here by design:** JS SDK v6 buttons (first task of Phase 5), reauthorize scheduling (Phase 5, a scheduled GitHub Action calling a protected endpoint), **step-security Harden-Runner egress allow-list on our public runner repo (a Phase 4 task: check whether it can enforce an allow-list; not added now)**, KERNEL, APIMatic plugin, AG Studio.
