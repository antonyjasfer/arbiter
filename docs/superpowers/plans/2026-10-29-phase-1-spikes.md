# Phase 1: Accounts and Risk Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the four risky integrations (PayPal authorize/capture/payout, Render Sandbox test runs with a network allow-list, PayPal webhook signature verification on a deployed URL, Anthropic structured output) work before any product code exists.

**Architecture:** Four independent, throwaway scripts in a `spikes/` folder sharing a tiny `lib/` (env loading, PayPal client). Each spike has its own pass criteria and a documented fallback. Results go in `spikes/FINDINGS.md`. No product code, no Next.js, no database.

**Tech Stack:** Node 18+ (recommend current 24.x LTS), TypeScript strict, `tsx`, Vitest (helpers only), `zod`, `@anthropic-ai/sdk`, `@renderinc/sdk@^1.5.0`, PayPal REST via `fetch` (no PayPal SDK, so we control `PayPal-Request-Id`).

**Spec:** `docs/arbiter-plan.md` (section 9 Phase 1, section 11 fallbacks, section 13 manual tasks); rules in `CLAUDE.md`.

## Global Constraints

- Phase 1 only: no application scaffolding, no Drizzle/Auth.js/Next.js. `spikes/` is labelled throwaway.
- Never print, log or commit secret values. Env check reports variable **names** only. `.env.local` is git-ignored; `spikes/.out/` is git-ignored.
- Env var names: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT` (must equal `SANDBOX`; scripts refuse to run otherwise), `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `RENDER_WORKSPACE_ID`. New non-secret/derived names introduced here (add to `.env.local`): `PAYPAL_FREELANCER_EMAIL` (sandbox personal #2), `PAYPAL_WEBHOOK_ID` (from the dashboard after registering the webhook), `FIXTURE_REPO_URL` (public fixture repo, Task 3).
- PayPal sandbox host only: `https://api-m.sandbox.paypal.com`. Every PayPal **write** sends a fresh `PayPal-Request-Id` (UUID v4), stored in the run summary.
- Model id verbatim: `claude-haiku-5-5`. Structured output via `output_config.format` / `zodOutputFormat` (the `output_format` parameter is deprecated).
- Render sandbox network policy type `allow-list`; rules are lowercase hostnames, HTTPS only; sandbox must be terminated on every exit path (success, error, SIGINT).
- Deadline context: Phase 1 runs 29-31 Oct 2026; submission closes 01:30 IST 13 Nov.
- Coding model: `/model sonnet` for every task (haiku acceptable for Task 4). Use `fable` only after two failed debugging attempts on one problem.

## Review Focus

1. **Missing or blank env var:** exits code 2 listing missing variable names only, never values, before any network call.
2. **Buyer abandons or cancels at PayPal:** script waits up to 5 minutes for the redirect, then exits non-zero printing the order id; it must not authorize or capture.
3. **Payout is `PENDING` or item is `UNCLAIMED`/`FAILED`:** script polls (max 2 minutes), prints the real status and exits non-zero unless the item is succeeded; it never reports PASS on a pending payout.
4. **Webhook body re-serialization:** the verify request must embed the received body byte-for-byte (unicode, whitespace, key order); a parsed-and-restringified body must not be what is sent.
5. **Sandbox leak or hang:** a failing clone, test failure, thrown error or Ctrl-C still terminates the sandbox; the script prints the sandbox id so it can be checked in the dashboard.
6. **Model returns no parsed output** (refusal, `max_tokens` stop): script exits non-zero with `stop_reason`, not a crash on `null`.

---

## File Structure

```
spikes/
  package.json                     # type: module, scripts, deps
  tsconfig.json                    # strict
  FINDINGS.md                      # Task 7
  lib/env.ts                       # requireEnv
  lib/env.test.ts
  lib/paypal.ts                    # token + ppFetch + newRequestId
  lib/paypal.test.ts
  lib/approval-server.ts           # local redirect catcher for buyer approval
  01-paypal.ts                     # Spike 1
  02-render-sandbox.ts             # Spike 2
  lib/exec.ts                      # collectExec
  lib/exec.test.ts
  fixtures/node-fixture/           # tiny Node project (published separately, Task 3)
  03-webhook/server.ts             # Spike 3 (deployed to Render)
  03-webhook/verify.ts             # buildVerifyBody
  03-webhook/verify.test.ts
  03-webhook/package.json          # deployable unit (own deps, start script)
  04-anthropic.ts                  # Spike 4
```

---

### Task 1: Spike workspace and shared helpers

**Files:**
- Create: `spikes/package.json`, `spikes/tsconfig.json`, `spikes/lib/env.ts`, `spikes/lib/paypal.ts`, `spikes/lib/approval-server.ts`
- Test: `spikes/lib/env.test.ts`, `spikes/lib/paypal.test.ts`

**Interfaces:**
- Produces:
  - `requireEnv(names: string[], source?: Record<string, string | undefined>): Record<string, string>`: loads `../.env.local` (relative to repo root) via `process.loadEnvFile`-style parsing when `source` omitted; throws `MissingEnvError` whose message lists missing **names only**; exits are the caller's job.
  - `newRequestId(): string` (UUID v4).
  - `getAccessToken(env: {PAYPAL_CLIENT_ID: string; PAYPAL_CLIENT_SECRET: string; PAYPAL_ENVIRONMENT: string}): Promise<string>`: refuses unless `PAYPAL_ENVIRONMENT === "SANDBOX"`.
  - `ppFetch<T>(token: string, method: "GET" | "POST", path: string, opts?: { body?: unknown; requestId?: string }): Promise<{ status: number; body: T; requestId?: string }>`: base URL `https://api-m.sandbox.paypal.com`; sets `PayPal-Request-Id` when `requestId` given; throws `PayPalError` (status, debug id from `PayPal-Debug-Id`, body name/message) on non-2xx.
  - `waitForApproval(port: number, timeoutMs: number): Promise<{ token: string; payerId: string }>`: starts `http://localhost:<port>`, resolves on `/return?token=...&PayerID=...`, rejects on `/cancel` or timeout; always closes the server.

- [ ] **Step 1: Write failing tests** `env.test.ts`: `requireEnv(["A","B"], {A:"x"})` throws and the message contains `B` and does not contain `x`; blank string counts as missing. `paypal.test.ts`: `newRequestId()` matches UUID v4 regex and two calls differ; `getAccessToken` rejects with a message mentioning `SANDBOX` when `PAYPAL_ENVIRONMENT` is `LIVE` (no network call made).
- [ ] **Step 2: Run** `cd spikes && npx vitest run lib` → FAIL (modules missing).
- [ ] **Step 3: Create `package.json`** (`"type": "module"`, scripts `spike:paypal`, `spike:sandbox`, `spike:anthropic`, `test`; deps `zod`, `@anthropic-ai/sdk`, `@renderinc/sdk@^1.5.0`; dev deps `tsx`, `typescript`, `vitest`, `@types/node`) and strict `tsconfig.json`; `npm install` inside `spikes/`.
- [ ] **Step 4: Implement** `lib/env.ts`, `lib/paypal.ts` (OAuth: `POST /v1/oauth2/token`, Basic auth, `grant_type=client_credentials`), `lib/approval-server.ts` per Interfaces.
- [ ] **Step 5: Run** `npx vitest run lib` → PASS; `npx tsc --noEmit` → no errors.
- [ ] **Step 6: Commit** `chore(spikes): workspace and shared PayPal/env helpers`

---

### Task 2: Spike 1, PayPal authorize, capture, payout

**Files:**
- Create: `spikes/01-paypal.ts`

**Interfaces:**
- Consumes: `requireEnv`, `getAccessToken`, `ppFetch`, `newRequestId`, `waitForApproval` (Task 1).
- Produces: `spikes/.out/paypal-run.json` (ids, statuses, request ids; git-ignored). CLI: `npm run spike:paypal` (main flow); flags `--probe` (void + reauthorize probe flow).

**Flow of the main run** (each PayPal write has its own `PayPal-Request-Id`):
1. `POST /v2/checkout/orders` body: `intent: "AUTHORIZE"`, one `purchase_units[0]` with `amount {currency_code:"USD", value:"10.00"}`, `payment_source.paypal.experience_context {user_action:"PAY_NOW", shipping_preference:"NO_SHIPPING", return_url:"http://localhost:3456/return", cancel_url:"http://localhost:3456/cancel"}`. Expect `PAYER_ACTION_REQUIRED`; print the link with `rel: "payer-action"`.
2. Wait for approval via `waitForApproval(3456, 300000)`.
3. `POST /v2/checkout/orders/{id}/authorize` → read `purchase_units[0].payments.authorizations[0]` (`id`, `status`, and `expiration_time` if present).
4. `POST /v2/payments/authorizations/{authId}/capture` body `{amount {USD 10.00}, final_capture: true}` → `capture id`, status `COMPLETED`.
5. Idempotency replay: repeat step 4 with the **same** request id; record whether the same capture id returns (expected) or an error.
6. `POST /v1/payments/payouts` with `sender_batch_header {sender_batch_id: "spike1-<timestamp>", email_subject}`, one item `{recipient_type:"EMAIL", receiver: PAYPAL_FREELANCER_EMAIL, amount {USD 9.00}, sender_item_id}` (9.00 not 10.00 so the capture fee cannot starve the payout; record this in FINDINGS). Poll `GET /v1/payments/payouts/{batch_id}` every 5 s up to 120 s.
7. Print a summary table: order id, auth id + expiration, capture id, payout batch id, item `transaction_status`, all request ids.

**`--probe` flow:** new $5.00 AUTHORIZE order, second buyer approval, authorize, `POST /v2/payments/authorizations/{id}/reauthorize` (record status/error verbatim, it is expected to be rejected inside the 3-day honor period), then `POST .../void` (expect 204).

- [ ] **Step 1: Hand step (you, before running):** confirm `.env.local` has the six names plus `PAYPAL_FREELANCER_EMAIL`; Payouts ticked on the sandbox app; business sandbox account exists. Have the **client** personal sandbox login ready (passwords stay in the dashboard).
- [ ] **Step 2: Implement** `01-paypal.ts` per the flow above: on any failure print `PayPalError` fields (status, debug id, name, message) and exit 1; on abandoned approval exit 1 without authorizing.
- [ ] **Step 3: Run** `npm run spike:paypal`. When the URL prints, open it in a private window, log in as the **client** sandbox personal account, approve.
  Expected output ends with `RESULT: PASS` and shows statuses `AUTHORIZATION CREATED`, `CAPTURE COMPLETED`, payout item `SUCCESS`; replay shows the same capture id.
- [ ] **Step 4: Verify by hand:** in sandbox.paypal.com, the freelancer account shows +9.00 USD; the business account shows the capture.
- [ ] **Step 5: Run** `npm run spike:paypal -- --probe`; approve once more; record the reauthorize response and void result.
- [ ] **Step 6: Commit** `spike(paypal): authorize, capture, payout, probe flows`

**Pass:** all of step 3-4 outputs plus void 204. **Fallback (plan section 11):** if Payouts is blocked or the item fails for account reasons, set the freelancer's **business** sandbox account as `payee.email_address` on the order so capture pays them directly, and record that Payouts was unavailable. If sign-up/sandbox is blocked from India: ask in the PayPal Discord immediately; try a US sandbox region. **Model:** sonnet.

---

### Task 3: Fixture repo for Spike 2

**Files:**
- Create: `spikes/fixtures/node-fixture/{package.json,package-lock.json,index.js,test/index.test.js,README.md}`

**Interfaces:**
- Produces: a public GitHub repo `arbiter-spike-fixture` with branches `pass` (tests exit 0) and `fail` (one deliberately failing test, exit non-zero), exposed as `FIXTURE_REPO_URL=https://github.com/<you>/arbiter-spike-fixture`.

- [ ] **Step 1: Create the fixture** so `npm test` runs `node --test`, one real dependency (`ms`) imported by `index.js` so `npm ci` must reach `registry.npmjs.org`, and a lockfile (`npm install --package-lock-only`).
- [ ] **Step 2: Run locally** `cd spikes/fixtures/node-fixture && npm ci && npm test` → exit 0.
- [ ] **Step 3: Hand step (you):** create the public repo and push two branches, `pass` as above and `fail` with one assertion changed to be false (`gh repo create arbiter-spike-fixture --public` then push; this publishes under your account so confirm before running). Add the URL to `.env.local` as `FIXTURE_REPO_URL`.
- [ ] **Step 4: Commit** `spike(fixture): tiny node project with one dependency`

**Pass:** both branches visible on GitHub; `fail` branch gives non-zero locally. **Model:** sonnet.

---

### Task 4: Spike 2, Render Sandbox runs untrusted tests

**Files:**
- Create: `spikes/lib/exec.ts`, `spikes/02-render-sandbox.ts`
- Test: `spikes/lib/exec.test.ts`

**Interfaces:**
- Produces: `collectExec(events: AsyncIterable<{type:"output"; stream:"stdout"|"stderr"; data:string} | {type:"exit"; exit_code:number}>): Promise<{exitCode:number; stdout:string; stderr:string}>`: concatenates output by stream; non-zero exit does not throw; throws if no `exit` event arrives.
- CLI: `npm run spike:sandbox -- <pass|fail>` (branch name).

- [ ] **Step 1: Write failing test** `exec.test.ts` with a fake async generator: two stdout chunks + one stderr chunk + `exit 1` → `{exitCode:1, stdout:"ab", stderr:"e"}`; a stream with no exit event rejects.
- [ ] **Step 2: Run** `npx vitest run lib/exec` → FAIL; then **implement** `collectExec` → PASS.
- [ ] **Step 3: Implement `02-render-sandbox.ts`** using `@renderinc/sdk`: `new Render().sandboxes.create({ plan:"1c-2g", wait:true, timeoutSeconds:600, idleTimeoutSeconds:300, ownerId: RENDER_WORKSPACE_ID, networkPolicy:{ type:"allow-list", rules:[{domain:"github.com",protocol:"https"},{domain:"registry.npmjs.org",protocol:"https"}] } })`. Authentication via `RENDER_API_KEY` is assumed from SDK defaults; confirm in the first run. Sequence through `exec` (runs under `bash -c`; use `collectExec`): (a) `node -v && npm -v && git --version`; (b) `git clone --depth 1 --branch <branch> $FIXTURE_REPO_URL repo`; (c) `cd repo && npm ci && npm test`; (d) negative egress check `curl -sS -m 10 https://example.com` which **must** fail; (e) `terminate` in a `finally` block and on SIGINT. Print sandbox id, per-step exit code, last 20 log lines, total wall time. If a step needs another host (e.g. a GitHub redirect host), add it to the allow-list and **record the final working list** for FINDINGS.
- [ ] **Step 4: Run** `npm run spike:sandbox -- pass`
  Expected: step (a) prints versions; (c) exit 0; (d) non-zero; sandbox terminated line printed; `RESULT: PASS`.
- [ ] **Step 5: Run** `npm run spike:sandbox -- fail` → step (c) exit non-zero while the script itself reports the expected failure verdict; still terminates the sandbox.
- [ ] **Step 6: Commit** `spike(sandbox): render sandbox clone + test + egress check`

**Pass:** pass branch exit 0, fail branch exit non-zero, example.com blocked, sandbox terminated, wall time recorded (target under 3 minutes). **Fallback:** if `git` is absent, fetch the tarball from the GitHub API on the host and `upload(sandboxId, path, data, ownerId, {contentType:"application/x-tar"})` (matches Phase 4 repo fetch). If the allow-list is not enforced or sandboxes are unstable, switch to E2B behind the same `runInSandbox(command)` shape and record it. **Model:** sonnet (opus only if the allow-list behaves unexpectedly).

---

### Task 5: Spike 3, webhook endpoint with signature verification

**Files:**
- Create: `spikes/03-webhook/package.json`, `spikes/03-webhook/server.ts`, `spikes/03-webhook/verify.ts`
- Test: `spikes/03-webhook/verify.test.ts`

**Interfaces:**
- Produces: `buildVerifyBody(headers: Record<string, string | undefined>, rawBody: string, webhookId: string): string`: returns the JSON **string** for `POST /v1/notifications/verify-webhook-signature` with fields `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `paypal-*` headers, header names case-insensitive), `webhook_id`, and `webhook_event` set to `rawBody` embedded verbatim. Throws if a required header is missing.
- Server: `GET /health` → 200; `POST /webhook` → reads raw body, builds the body, calls PayPal with an OAuth token, returns 200 only when `verification_status === "SUCCESS"`, otherwise 400. Logs only: event id, event type, verification status (no payloads, no headers).

- [ ] **Step 1: Write failing test** `verify.test.ts`: raw body `{"id":"WH-1","note":"héllo  ☃","a":1}` (with double spaces and unicode) appears **byte-identical** inside the returned string at `"webhook_event":<raw>`; missing `paypal-transmission-sig` header throws.
- [ ] **Step 2: Run** `npx vitest run 03-webhook` → FAIL; **implement** `buildVerifyBody` by string concatenation for `webhook_event` (never `JSON.stringify` the parsed event) → PASS.
- [ ] **Step 3: Implement `server.ts`** with `node:http`, port from `process.env.PORT`, env `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT`, `PAYPAL_WEBHOOK_ID`; reuse the `getAccessToken` logic (copy the 20 lines into this folder; the deployable unit must not depend on `../lib`).
- [ ] **Step 4: Hand steps (you):** (a) push the repo to GitHub as `arbiter` (public, MIT) when ready, since Render deploys from GitHub; (b) deploy `spikes/03-webhook` as a Render **web service** (root dir `spikes/03-webhook`, build `npm ci`, start `npx tsx server.ts`) using the Render plugin or dashboard; set the four env vars in Render's dashboard (not in chat; `PAYPAL_WEBHOOK_ID` comes from step c); (c) in the PayPal sandbox app → Webhooks → add `https://<service>.onrender.com/webhook`, select the capture, authorization, order-approved and payouts events by name from the dashboard list, copy the **Webhook ID**.
- [ ] **Step 5: Verify negative case:** `curl -i -X POST https://<service>.onrender.com/webhook -H "paypal-transmission-id: x" ... -d '{}'` (forged headers) → HTTP 400, log shows non-`SUCCESS`.
- [ ] **Step 6: Verify positive case:** re-run `npm run spike:paypal` (Task 2). Within a minute Render logs show `type=PAYMENT.CAPTURE.COMPLETED verification=SUCCESS` (and one authorization event). The dashboard's "simulate event" tool sends **mock** events that postback verification does not support, so use real events only.
- [ ] **Step 7: Commit** `spike(webhook): paypal webhook receiver with signature verification`

**Pass:** forged request rejected; at least one real event verified `SUCCESS` on the deployed URL. Free instances sleep and PayPal retries; note cold-start behaviour in FINDINGS. **Fallback:** if postback verification fails repeatedly, record the failing headers' names (not values) and verify the cert-chain manually per PayPal docs, or ask in the Discord; if deployment fails, use a tunnel for the spike and record that Render hosting is unproven. **Model:** sonnet.

---

### Task 6: Spike 4, Anthropic structured output

**Files:**
- Create: `spikes/04-anthropic.ts`

**Interfaces:**
- Consumes: `requireEnv` (Task 1).
- Produces: CLI `npm run spike:anthropic`; exits 0 only when output validates.

- [ ] **Step 1: Implement** a Zod `AgreementSketch` schema: `milestones: [{ title: string, amount_usd: number, criteria: [{ text: string, kind: "test"|"browser"|"static"|"review", testable: boolean }] }]` and `ambiguity_questions: string[]` (no `.min()/.max()` constraints, the API does not support them). Call `client.messages.parse({ model:"claude-haiku-5-5", max_tokens:1500, messages:[{role:"user", content:<short sample brief containing one vague phrase like "make it fast">}], output_config:{ format: zodOutputFormat(AgreementSketch) } })` (`import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"`). Then re-validate `response.parsed_output` with `AgreementSketch.parse`. If `parsed_output` is null, print `stop_reason` and exit 1.
- [ ] **Step 2: Run** `npm run spike:anthropic`
  Expected: prints the parsed milestones, at least one entry in `ambiguity_questions`, token usage and an estimated cost under $0.01, then `RESULT: PASS`.
- [ ] **Step 3: Commit** `spike(anthropic): haiku structured output with zod`

**Pass:** valid parse on first try, cost recorded. **Fallback (plan section 8):** if structured outputs error for this model or SDK, request JSON in the prompt, `safeParse` with Zod, retry once with the validation error, then fall back to `claude-sonnet-5-5`. **Model:** sonnet or haiku.

---

### Task 7: Findings note and phase gate

**Files:**
- Create: `spikes/FINDINGS.md`

- [ ] **Step 1: Create `spikes/FINDINGS.md`** with this template, filled in from real runs (ids and statuses only, no secrets):

```markdown
# Phase 1 Findings (YYYY-MM-DD)

| Spike | Result (PASS / PARTIAL / FAIL) | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | | |
| 2 Render Sandbox | | |
| 3 Webhook verify (deployed) | | |
| 4 Anthropic structured output | | |

## 1 PayPal
- Order / authorization / capture / payout batch ids:
- Authorization `expiration_time` seen (US sandbox; docs conflict on 3 vs 29 days):
- Replay with same PayPal-Request-Id returned:
- Payout amount vs capture, fee behaviour:
- Reauthorize probe response (verbatim error name):
- Void result:
- Surprises / API differences from docs:

## 2 Render Sandbox
- Final working allow-list rules:
- git / node / npm present in image:
- Pass-branch exit code / fail-branch exit code / egress block confirmed:
- Wall time, plan used, approximate credit cost:
- Docs vs behaviour (beta status, early-access items):

## 3 Webhook
- Verified event types seen:
- Forged request response:
- Cold-start / retry behaviour on the Render instance:
- Webhook ID location and env handling:

## 4 Anthropic
- Parsed first try (y/n), schema constraints that failed:
- Tokens in/out, cost:
- stop_reason handling:

## Decisions for Phase 2
- Keep / change from the plan:
- Fallbacks invoked:
- Open risks carried forward:
```

- [ ] **Step 2: Run the full check:** `cd spikes && npx vitest run && npx tsc --noEmit` → all pass.
- [ ] **Step 3: Commit** `docs(spikes): phase 1 findings`
- [ ] **Step 4: Stop.** Report PASS/PARTIAL/FAIL per spike and wait for the user's approval before Phase 2.

---

## Self-review

- **Spec coverage:** PayPal OAuth + AUTHORIZE + approve + authorize + capture + Payout with request ids (Task 2); idempotency replay, void and reauthorize probe (Task 2); sandbox with allow-list, clone, tests, exit code, terminate (Tasks 3-4); webhook endpoint deployable to Render with signature verification (Task 5); `claude-haiku-5-5` structured output validated with Zod (Task 6); findings template (Task 7).
- **Open assumptions to confirm during execution (not verified by running):** Render SDK reads `RENDER_API_KEY` from env; sandbox image includes `git`/`node`; allow-list needs only `github.com` + `registry.npmjs.org`; PayPal `expiration_time` is returned in the US sandbox; payout fee behaviour.
- **Not covered here by design:** JS SDK v6 buttons (Phase 5), Render Workflows (Phase 4), KERNEL, APIMatic plugin, AG Studio.
