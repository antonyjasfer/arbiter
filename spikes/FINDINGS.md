# Phase 1 Findings (in progress, started 2026-10-29)

| Spike | Result | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | PARTIAL: authorize, idempotent capture replay and payout SUCCEED; capture stayed PENDING (PENDING_REVIEW), so the spike's own pass test (COMPLETED) FAILED; `--probe` PASS | 2026-10-29 |
| 2 GitHub Actions runner | PASS (pass, fail, probe, reject all as expected) | 2026-10-29 |
| 3 Webhook verify (Render Free) | NOT RUN (needs the repo on GitHub and a Render deploy) | |
| 4 Gemini structured output | PASS on `gemini-3.6-flash` (3.8 overloaded) | 2026-10-29 |
| 5 Neon ping | PASS | 2026-10-29 |

## What passes locally (real output, 2026-10-29)
- `npx vitest run` in `spikes/`: 5 test files, 40 tests passed. `npx tsc --noEmit`: no errors.
- Fixture repo built locally from `spikes/fixtures/build-fixture-repo.mjs` (not pushed): branch `pass` exit 0, `fail` exit 1, `probe` exit 0 with a clean environment and exit 1 when `SPIKE_CANARY` is present.
- Workflow `validate` block run locally against hostile inputs (shell command in repo URL, SHA, run id; http deploy URL; newline injection; control character): each rejected, valid inputs accepted, nothing executed. This is a local test of the script text, not the GitHub run; the `reject` case on GitHub is still to do.
- Webhook server run locally: `/health` 200; forged POST with no webhook id → 503; with a webhook id and missing PayPal headers → 400. Real signature verification is not yet tested.

## 1 PayPal (main flow run 2026-10-29, USD 50.00)
- Order 08S03373ND071491C, authorization 77A208102C556205J (status CREATED), capture 3PW138358B024184X, payout batch FPTNNNWCC7JM6. Request ids are in `spikes/.out/paypal-run.json` (git-ignored).
- **Authorization `expiration_time` = 2026-11-27T15:29:26Z, about 29 days from authorization** (US sandbox). The 3-day figure in some docs is the honor period, not the validity; the reauthorize probe still has to show what happens on day 3.
- **Capture status was PENDING, reason PENDING_REVIEW** (re-read later: still PENDING; the authorization shows CAPTURED). So a successful capture call does not mean money is settled. The spike's pass criterion (capture COMPLETED) therefore reported FAIL; I did not loosen it. The Phase 5 state machine needs a CAPTURE_PENDING state, must wait for `PAYMENT.CAPTURE.COMPLETED` (via webhook plus a fetch from PayPal) before treating the milestone as paid or releasing the payout, and the payment guard must refuse payout while the capture is PENDING. Open question for you: check the sandbox business account (developer.paypal.com → Testing tools → Sandbox accounts → that account → settings / payment review) for why captures are held; I could not tell from the API.
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
- Pending.

## 4 Gemini
- First attempt failed because a stale `GEMINI_API_KEY` in the shell environment (39 chars, the leaked one) overrode the new key in `.env.local`. Fixed in `lib/env.ts`: `.env.local` now wins over shell variables. The user should delete the stale variable from their Windows environment.
- Pricing-page row checked 29 Oct: `gemini-3.8-flash` (Stable, "Free of charge"). Real behaviour the same day on the free tier: `gemini-3.8-flash` returned HTTP 503 "high demand" and timed out at 60 s and 150 s on a one-word prompt. `gemini-3.6-flash` (also a "Free of charge" Flash row) works. `gemini-2.5-flash` returns 404 "no longer available to new users". **Chosen for now: `gemini-3.6-flash`**; re-test `gemini-3.8-flash` before submission.
- `models.get` works for both: input limit 1,048,576 tokens, output limit 65,536.
- API surface that worked: `interactions.create` with `response_format {type:"text", mime_type:"application/json", schema}` and `store:false`. Parsed on the first try, no re-ask. 140 tokens in, 451 out, 25.4 s for the first call, 21 ms for the cached second call. `generateContent` was only tried against the REST endpoint (works on 3.6 with `thinkingLevel: "minimal"`: 1.2–17.6 s on a trivial prompt).
- Latency is erratic on the free tier: the same trivial prompt took 1.2 s to 28 s. `thinkingLevel: "minimal"` is accepted by 3.6 but rejected by 3.8 (HTTP 400). Not yet wired into the SDK path. Design the UI for 5–30 s AI waits and keep the cache for seeded demos.
- Free-tier limits: the message you sent still contained the template placeholders ("[RPM] RPM, [TPM] TPM, [RPD] RPD"), so the numbers are NOT recorded. Please send the real values for `gemini-3.6-flash` (and `gemini-3.8-flash`).
- Free tier trains on prompts (docs: yes): only public repo content and seeded text are ever sent.
- Adapter now has a 90 s timeout and maps HTTP 429/503 to the typed `busy` result.

## 5 Neon
- Connected through `DATABASE_URL`; PostgreSQL 18.6. First connect + `SELECT 1` + `SHOW server_version`: 4149 ms. Second (warm): 3275 ms. Both include a fresh TLS connection from India to us-east-1, so a new connection per request is slow; Phase 2 should reuse a connection pool. A true cold start (after 6+ idle minutes) has not been measured yet.
- `pg` printed an SSL-mode deprecation warning; set `sslmode=verify-full` explicitly in the connection string or config in Phase 2.

## Decisions for Phase 2
- Neon (user note): use the pooled connection, set sslmode explicitly, and evaluate Neon's serverless driver to cut the 3-4 s connect time.
- Screenshots (user note): browser-screenshot artifacts come only from the separate browser job that runs no repo code, never from the tests job (already how verify.yml is built).
- Gemini: default model is gemini-3.6-flash (accepted by the user); re-test gemini-3.8-flash before submission.
- Phase 3 (user note): AI calls can take up to about 30 s, so the agreement compiler must run as a background job with a progress state in the UI and never block a request.
- Repos antonyjasfer/arbiter-spike-fixture and antonyjasfer/arbiter-runner created (public, empty) on 2026-10-29; nothing pushed yet.
- Pending the remaining spikes.
