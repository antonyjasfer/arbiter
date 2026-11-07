# Phase 1 Findings (2026-10-29 to 2026-11-03)

| Spike | Result | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | PARTIAL: authorize, idempotent capture replay and payout SUCCEED; capture stayed PENDING (PENDING_REVIEW), so the spike's own pass test (COMPLETED) FAILED; `--probe` PASS | 2026-10-29 |
| 2 GitHub Actions runner | PASS (pass, fail, probe, reject all as expected) | 2026-10-29 |
| 3 Webhook verify (Render Free) | PASS: 5 of 5 real events verified SUCCESS; forged requests 400; cold start 23.7 s (one sample) | 2026-11-03 |
| 4 Gemini structured output | PASS on `gemini-3.6-flash` (3.8 overloaded) | 2026-10-29 |
| 5 Neon ping | PASS | 2026-10-29 |

## What passes locally (real output, 2026-10-29)
- `npx vitest run` in `spikes/`: 5 test files, 40 tests passed. `npx tsc --noEmit`: no errors.
- Fixture repo built locally from `spikes/fixtures/build-fixture-repo.mjs` (not pushed): branch `pass` exit 0, `fail` exit 1, `probe` exit 0 with a clean environment and exit 1 when `SPIKE_CANARY` is present.
- Workflow `validate` block run locally against hostile inputs (shell command in repo URL, SHA, run id; http deploy URL; newline injection; control character): each rejected, valid inputs accepted, nothing executed. This was a local test of the script text; the `reject` case later passed on GitHub (section 2).
- Webhook server run locally: `/health` 200; forged POST with no webhook id → 503; with a webhook id and missing PayPal headers → 400. Real signature verification was tested later on Render (section 3).

## 1 PayPal (main flow run 2026-10-29, USD 50.00)
- Order 08S03373ND071491C, authorization 77A208102C556205J (status CREATED), capture 3PW138358B024184X, payout batch FPTNNNWCC7JM6. Request ids are in `spikes/.out/paypal-run.json` (git-ignored).
- **Authorization `expiration_time` = 2026-11-27T15:29:26Z, about 29 days from authorization** (US sandbox). The 3-day figure in some docs is the honor period, not the validity; the reauthorize probe still has to show what happens on day 3.
- **Capture status was PENDING, reason PENDING_REVIEW** (re-read later: still PENDING; the authorization shows CAPTURED). So a successful capture call does not mean money is settled. The spike's pass criterion (capture COMPLETED) therefore reported FAIL; I did not loosen it. The Phase 5 state machine needs a CAPTURE_PENDING state, must wait for `PAYMENT.CAPTURE.COMPLETED` (via webhook plus a fetch from PayPal) before treating the milestone as paid or releasing the payout, and the payment guard must refuse payout while the capture is PENDING. Why captures are held is still unknown; the user asked in the PayPal Discord on 3 Nov.
- **Capture status over time:** the 29 Oct capture 3PW138358B024184X read COMPLETED on 3 Nov, so the sandbox hold cleared on its own within about 4 days (exact time unknown; no webhook existed for most of that time). The 3 Nov capture 0V538190PA744902Y was still PENDING / PENDING_REVIEW 19 minutes later. Same fee, same 29-day expiry (2026-12-01T23:24:53Z), same replay result and same SUCCESS payout on the second run; the spike's own COMPLETED check failed again for the same reason.
- **Idempotency:** replaying the capture with the same `PayPal-Request-Id` returned HTTP 200 with the same capture id.
- **Payout** of 47.50 to the freelancer: batch SUCCESS, item SUCCESS, even though the capture was still PENDING (the sandbox does not enforce settled funds). Do not rely on that in the product.
- **Real capture fee:** gross 50.00, PayPal fee 2.24, net 47.76 = 4.48% of the amount. That matches 3.49% + 0.49 fixed (1.7451 + 0.49 = 2.2351, rounded 2.24); one data point, treat the exact split as an inference.
- **Real payout fee:** 0.25 (batch fees 0.25) on a 47.50 payout.
- **Fee coverage at 5%:** net 47.76 - payout 47.50 - payout fee 0.25 = **+0.01**. The 5% platform fee (2.50) is almost entirely consumed by PayPal's costs (2.24 + 0.25 = 2.49). For Phase 5: fee = a percentage plus a fixed amount covering PayPal's 3.49% + 0.49 capture fee and the payout fee, plus an Arbiter margin; compute the payout as milestone minus that fee, never as a flat 95%.
- Approval: the first four attempts timed out because I waited inside a single turn; the order never reached APPROVED. The fifth run used a 30-minute window plus polling the order status and worked. The localhost redirect was not needed.
- **`--probe` (USD 5.00) PASS:** authorization 0M789984BD431102H CREATED, `expiration_time` 2026-11-27T15:36:59Z (29 days again). `reauthorize` immediately after authorizing was **rejected: HTTP 422 UNPROCESSABLE_ENTITY** ("could not be performed, semantically incorrect, or failed business validation", debug id f871826bc43a8), as expected inside the honor period; this does not yet show whether reauthorize works after day 3, which can only be tested after 3 days (try on or after 1 Nov with this authorization if it were not voided; start a new unvoided one to test). **Void returned HTTP 204.** Design note: Phase 5's day-3 reauthorize job must treat a 422 as "not yet allowed / not needed" and not as a failure, and because the authorization already lasts 29 days, reauthorize may only be needed for the funds guarantee.

## 2 GitHub Actions runner (live runs, 2026-10-29)
- Repos: antonyjasfer/arbiter-runner (default branch main, workflow verify.yml) and antonyjasfer/arbiter-spike-fixture (branches pass, fail, probe; default set to pass). Secret scan before push: clean.
- Dispatch response: **HTTP 204 with no run id** (the GitHub docs page says 200 with workflow_run_id; reality differs). Run matching by `run-name: verify <run_id>` worked every time.
- Runs: pass https://github.com/antonyjasfer/arbiter-runner/actions/runs/40892765041 (conclusion success, ~61 s total, ~6 s queue); fail .../40892765720 (failure, ~39 s); probe .../40892764863 (success, ~42 s).
- Jobs API gives usable verdicts: pass: validate, tests, canary-holder, browser all success, steps install and unit-tests success. fail: job tests failure with step unit-tests failure while browser and canary-holder stay success. Step and job conclusions are reliable verdict sources.
- Secret probe: canary-holder printed `canary length: 17` (the secret exists in the repo and was masked in the log); the tests job on the probe branch printed `credential-shaped env var names: []` and all 4 tests passed (no SPIKE_CANARY, GITHUB_TOKEN, ACTIONS_RUNTIME_TOKEN or ACTIONS_ID_TOKEN_REQUEST_* visible to the test process). The limit stands: this is an environment check, not proof against a root process on the VM; no secret exists in that job by design.
- Hostile inputs (reject): all four dispatches (repo_url with `;touch /tmp/pwned`, commit_sha `HEAD;id`, deploy_url over http, run_id `1;id`) ended with `validate` failure and tests, browser, canary-holder all `skipped`.
- Artifact download with the fine-grained token (Actions read, Contents read): worked; only `browser-screenshot/screenshot.png` was present (tests uploads nothing); the allow-list accepted it.
- Runner image: Node v22.23.4, git 2.56.0. Playwright 1.64.1 install + browser check: browser job ~40-47 s; `browser check ok: status=200, title length=14` against https://example.com.
- Open egress was not separately tested; documented as an open limit. `actions/upload-artifact@v4` prints a Node.js 20 deprecation warning: move to the current major before Phase 4.
- Not yet tested: hostile repo content (malicious postinstall), 10-minute timeout behaviour.

## 3 Webhook (Render Free, Virginia)
- Deployed from `arbiter` main to https://arbiter-q41f.onrender.com (Node 26.13). First checks 2026-11-03, with `PAYPAL_WEBHOOK_ID` unset, on a warm instance (uptime 574 s):
  - `GET /health`: 200 in 0.79 s.
  - Forged `POST /webhook` with no PayPal headers: 503 `webhook_id not configured`, 0.41 s.
  - Forged `POST /webhook` with fake PayPal headers: 503 `webhook_id not configured`, 0.38 s.
  - `GET /webhook`: 404.
- These 503s only show that the service fails closed without a webhook id. They do not test signature verification.
- The PayPal dashboard's Add webhook form rejected this URL with "Please enter a valid url" (cause unknown). The API accepted the same URL: `POST /v1/notifications/webhooks` returned HTTP 201 and the read-back shows the URL and all 7 event types. Script: `03-webhook/register-webhook.ts` (reuses an existing webhook for the same URL). The id is in `.env.local`.
- With `PAYPAL_WEBHOOK_ID` set, forged requests: no PayPal headers 400 (`missing required header`), fake PayPal headers 400 (PayPal's verify endpoint returned FAILURE).
- Real events, second PayPal run on 2026-11-03 IST (order 7Y322603AR250312R, authorization 0US73908C81224019, capture 0V538190PA744902Y, payout batch SBYQVRNMHCTMG). Render log, 5 received, 5 `verification=SUCCESS`: PAYMENT.CAPTURE.PENDING, PAYMENT.AUTHORIZATION.CREATED, CHECKOUT.ORDER.APPROVED, PAYMENT.PAYOUTS-ITEM.SUCCEEDED, PAYMENT.PAYOUTSBATCH.SUCCESS.
- **Events arrive out of order:** CAPTURE.PENDING reached the server before AUTHORIZATION.CREATED and ORDER.APPROVED, and PayPal's create_time for ORDER.APPROVED is later than for the capture. Delivery lag was about 9-11 s from create_time. Phase 5 handlers must not depend on event order and must reconcile by fetching from PayPal.
- Not received: PAYMENT.CAPTURE.COMPLETED (capture still pending) and PAYMENT.AUTHORIZATION.VOIDED (the main flow does not void, and the probe's void ran before the webhook existed).
- **Cold start:** idle 17 min 16 s, first `GET /health` 23.7 s (`uptimeSeconds` 9.6 and a new instance id in the log confirm a real restart), then 1.9 s and 1.3 s. One sample; Render says to expect up to about a minute.
- Not tested: PayPal delivering an event to a sleeping service, PayPal's retry after a failed delivery, duplicate delivery. The spike has no de-duplication; Phase 5 does.
- A second Render service, `arbiter-spike-fixture`, also exists in the workspace (branch `pass`, root dir `spikes/03-webhook`). Not used by this spike; free instance hours are shared across a workspace.

## 4 Gemini
- First attempt failed because a stale `GEMINI_API_KEY` in the shell environment (39 chars, the leaked one) overrode the new key in `.env.local`. Fixed in `lib/env.ts`: `.env.local` now wins over shell variables. The user should delete the stale variable from their Windows environment.
- Pricing-page row checked 29 Oct: `gemini-3.8-flash` (Stable, "Free of charge"). Real behaviour the same day on the free tier: `gemini-3.8-flash` returned HTTP 503 "high demand" and timed out at 60 s and 150 s on a one-word prompt. `gemini-3.6-flash` (also a "Free of charge" Flash row) works. `gemini-2.5-flash` returns 404 "no longer available to new users". **Chosen for now: `gemini-3.6-flash`**; re-test `gemini-3.8-flash` before submission.
- `models.get` works for both: input limit 1,048,576 tokens, output limit 65,536.
- API surface that worked: `interactions.create` with `response_format {type:"text", mime_type:"application/json", schema}` and `store:false`. Parsed on the first try, no re-ask. 140 tokens in, 451 out, 25.4 s for the first call, 21 ms for the cached second call. `generateContent` was only tried against the REST endpoint (works on 3.6 with `thinkingLevel: "minimal"`: 1.2–17.6 s on a trivial prompt).
- Latency is erratic on the free tier: the same trivial prompt took 1.2 s to 28 s. `thinkingLevel: "minimal"` is accepted by 3.6 but rejected by 3.8 (HTTP 400). Not yet wired into the SDK path. Design the UI for 5–30 s AI waits and keep the cache for seeded demos.
- Free-tier limits: **not shown** in AI Studio (user, 3 Nov). Design for **10 RPM / 250 RPD**, protected by the cache and the busy state.
- Free tier trains on prompts (docs: yes): only public repo content and seeded text are ever sent.
- Adapter now has a 90 s timeout and maps HTTP 429/503 to the typed `busy` result.

## 5 Neon
- Connected through `DATABASE_URL`; PostgreSQL 18.6. First connect + `SELECT 1` + `SHOW server_version`: 4149 ms. Second (warm): 3275 ms. Both include a fresh TLS connection from India to us-east-1, so a new connection per request is slow; Phase 2 should reuse a connection pool. A true cold start (after 6+ idle minutes) has not been measured yet.
- `pg` printed an SSL-mode deprecation warning; set `sslmode=verify-full` explicitly in the connection string or config in Phase 2.

## Phase 2 live checks (2026-11-03, https://arbiter-q41f.onrender.com)
- Render service `arbiter`: root dir `web`, build `npm ci && npm run build`, start `npm run start`, health check `/api/health`, auto-deploy after CI checks pass. `/api/health` 200; `/api/health?db=1` 200 with `db: ok`.
- **Auth.js behind Render's proxy:** without `AUTH_URL`, Auth.js built every URL from the request host header, which on Render is `localhost:10000`, so GitHub got `redirect_uri=https://localhost:10000/api/auth/callback/github`. Setting `AUTH_URL=https://arbiter-q41f.onrender.com` fixed it (Auth.js `createActionURL` prefers `AUTH_URL`). After the fix the redirect_uri is the live callback, and the user signed in on the live site and reached `/dashboard`; one `users` row (login `antonyjasfer`) was created.
- Webhook moved into the app: `register-webhook.ts` PATCHed the existing webhook (same id, so `PAYPAL_WEBHOOK_ID` is unchanged) to `/api/webhooks/paypal`, 7 event types. Forged POSTs: no PayPal headers 400, fake headers 400 (PayPal verify FAILURE). Old `/webhook`: 404.
- Real events from a `--probe` run (order 1A643183C95993814, authorization 7XY64231T99249736, $5, voided 204): CHECKOUT.ORDER.APPROVED, PAYMENT.AUTHORIZATION.VOIDED, PAYMENT.AUTHORIZATION.CREATED, each verified and stored once. **VOIDED arrived before CREATED**; reconcile-by-fetch stored `VOIDED` for both authorization events, so a late event cannot roll state back.
- **Duplicate delivery (real):** PayPal `.../webhooks-events/{id}/resend` (HTTP 202) for CREATED and VOIDED at 10:12 UTC; both delivered about 4 s later, logged `verification=SUCCESS` then `duplicate=true reconciled=false`. Row count stayed 3 (3 distinct ids).
- **Lost delivery during a deploy:** a first resend at about 10:06 UTC, while Render was redeploying (10:05:55–10:07:23), never reached the app and was not retried within about 6 minutes. Deploys and sleeps can drop or delay webhooks, so Phase 5 must reconcile payment state by fetching from PayPal, not wait on webhooks.
- Reauthorize on a fresh authorization returns 422 (as in Phase 1); it is only allowed later in the honor period.
- Tests at the end of Phase 2: `web` 65 tests in 15 files; `spikes` 50 tests in 6 files; lint, typecheck and build clean; GitHub CI green.

## Phase 3 live checks (2026-11-04, https://arbiter-q41f.onrender.com, commit 26644e4)
- **Auto-deploy after CI works.** After the user reconnected the Render GitHub App, pushing 26644e4 (touches `web/`) ran CI (run 41815690586, passed 10:41:29 UTC) and Render started deploy dep-dblgnn2vcj2c738ngel0 by itself 3.5 s later (trigger `new_commit`, not manual); live 10:43:06 UTC. Before the reconnect, a push produced no Render event at all, so 4b77e98 was deployed by hand.
- **Demo mode:** landing shows "Try the demo"; `/api/auth/providers` lists `github, demo`. `DEMO_MODE` is read at build time for the static landing page, so changing it needs a redeploy.
- **Demo flow on the live site:** demo client signed in, opened TaskBoard, added the "easy to use" criterion as Needs human review and saved it as version 2 (version 1, the AI draft, kept unchanged), approved; demo freelancer approved; agreement locked, milestones AGREED; audit page "Chain verified ✓ · 8 events". Bakery "Draft with AI" came back from the cache in under 8 s with 3 milestones and 2 questions; `ai_usage` stayed empty (no live call). Reset demo restored both projects.
- **Speed (not precisely measured):** on Render (same region as Neon) each demo sign-in, save and approval had finished within the 4–5 s waits of the browser check; in local dev from India the same actions took 10–15 s (server log: approve 13.3 s, demo sign-in 9.6 s).
- **IDs:** `/api/compile-jobs/<forged or malformed id>` answers 404. Project and audit pages with a forged or malformed id render "404: This page could not be found." but with HTTP status 200, because the page shell streams before `notFound()` runs (Partial Prerender). No data is exposed.
- **Isolation:** the user's real GitHub account is not a demo user and has 0 project memberships, so its dashboard lists nothing; the demo boundary is covered by tests in both directions.
- **Gemini:** live calls from the warm-up script took 28.9 s (TaskBoard, 2 milestones, 1 question, 610/332 tokens) and 114.4 s (Bakery, 3 milestones, 2 questions, 417/619 tokens) on `gemini-3.6-flash`; both passed the checks. Gemini split TaskBoard $200/$100 with no review criterion; the real output is kept. An earlier attempt failed with 403 "API key was reported as leaked": a Windows user-level `GEMINI_API_KEY` (an old leaked key) was overriding `.env.local`, because `@next/env` never overwrites variables already set. The user removed it.
- **Tests at the end of Phase 3:** `web` 189 tests in 32 files; `spikes` 50 tests in 6 files; lint (0 errors), typecheck and build clean; GitHub CI green.

## Decisions for Phase 2
- Neon (user note): use the pooled connection, set sslmode explicitly, and evaluate Neon's serverless driver to cut the 3-4 s connect time.
- Screenshots (user note): browser-screenshot artifacts come only from the separate browser job that runs no repo code, never from the tests job (already how verify.yml is built).
- Gemini: default model is gemini-3.6-flash (accepted by the user); re-test gemini-3.8-flash before submission.
- Phase 3 (user note): AI calls can take up to about 30 s, so the agreement compiler must run as a background job with a progress state in the UI and never block a request.
- Webhooks: register through the API (`03-webhook/register-webhook.ts`), since the dashboard form rejected the Render URL. Handlers are order-independent; add a capture-pending state; payout waits for a COMPLETED capture read back from PayPal.
- Cold starts: the first request after idle takes about 24 s or more; persist state and never rely on in-process timers.

## Phase 4 live checks
_Filled in by the phase-4-verification branch. Phase 5 never edits this section._

## Phase 5 live checks
_Filled in by the phase-5-payments branch. Phase 4 never edits this section._

### Local end-to-end sandbox payment (Task 8), started 2026-11-07
- **Setup:** local only, `next build` + `next start -p 3001` with `DEMO_MODE=true`, branch `phase-5-payments` at commit `39fa3b2`, PayPal sandbox, shared Neon DB. Demo project TaskBoard (`c1954803-1064-457e-8df0-30cdce1af8f0`); client = demo client, payee = demo freelancer (`PAYPAL_FREELANCER_EMAIL`).
- **Why production mode:** on 6 Nov `next dev` ran out of memory (about 1 GB free of 8 GB): its route workers crashed on every new compile (`Jest worker encountered 2 child process exceptions`) and the project page answered 307. `next start` uses far less memory and served the page normally (10:41 IST).
- **No webhooks reach localhost:** every state move after funding comes from reconcile-on-poll (`GET /api/payments/:id`), which also exercises the lost-webhook path (Review Focus 5).
- **Run log** (IST; IDs from PayPal and the DB):
  - **Agreement:** v1 hash `5bafdd62…2df1`; client approved 16:16:09 IST (audit seq 5), freelancer approved 16:17:37 (seq 6), locked 16:17:44 (seq 7).
  - **Funding (Milestone 1, `781b8cb4-4ae2-4fa7-883a-123066d4b17d`, $200.00):** Arbiter payment `d7c7d693-11c2-42f6-aab9-098335bb434f` created 16:19:38 IST (`funding_started`, seq 8). PayPal order `8BU5772636892914Y`, authorization `2JT4063409777392S` (status `CREATED`), funded 16:21:46 IST (seq 9). Last reconciled 16:21:44 IST.
  - **Authorization window measured from PayPal:** `expiration_time` = 2026-12-06 10:51:43 UTC (16:21:43 IST), i.e. 29 days; honor period ends 2026-11-10 10:51:43 UTC (16:21:43 IST), i.e. 3 days. Fee $11.00, payout amount $189.00 (stored on the payment row).
  - **Test-only move to REPORT_READY (no HTTP route):** `node --conditions=react-server --import tsx scripts/dev-report-ready.ts 781b8cb4-…` ran 16:25:31–16:25:45 IST, exit 0, no PayPal calls. Fixture submission `8ee9b2ab-54ee-483a-b343-72c84629a6f3` (seq 10, 16:25:38), run `f43d09b1-2c42-498f-b554-a1826c5ea6fe` (seq 11 `verification_started` 16:25:39, seq 12 `verification_finished` 16:25:43), 6 criteria all `needs_review`, every event `testOnly: true`. Milestone state FUNDED (v2) → REPORT_READY (v5). Payment row unchanged (`authorized`, no capture or payout IDs yet).
  - _Next: client approval and release (capture + payout), recorded below._
- **Noted for Phase 6 (not fixed here):** `/dashboard` logs a Next prerender error, `crypto.getRandomValues()` called while prerendering at `src/app/(app)/dashboard/page.tsx:65` (`<Projects />`); the page still returns 200. Fix with a dynamic access (`await connection()`) or by moving the random value to the client.
