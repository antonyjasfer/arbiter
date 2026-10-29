# Phase 1 Findings (in progress, started 2026-10-29)

| Spike | Result | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | NOT RUN (needs your buyer approval in a private window) | |
| 2 GitHub Actions runner | NOT RUN (needs pushes to `arbiter-spike-fixture` and `arbiter-runner`, and the `SPIKE_CANARY` secret) | |
| 3 Webhook verify (Render Free) | NOT RUN (needs the repo on GitHub and a Render deploy) | |
| 4 Gemini structured output | BLOCKED: Google rejected the API key as leaked (HTTP 403 PERMISSION_DENIED) | 2026-10-29 |
| 5 Neon ping | PASS | 2026-10-29 |

## What passes locally (real output, 2026-10-29)
- `npx vitest run` in `spikes/`: 5 test files, 40 tests passed. `npx tsc --noEmit`: no errors.
- Fixture repo built locally from `spikes/fixtures/build-fixture-repo.mjs` (not pushed): branch `pass` exit 0, `fail` exit 1, `probe` exit 0 with a clean environment and exit 1 when `SPIKE_CANARY` is present.
- Workflow `validate` block run locally against hostile inputs (shell command in repo URL, SHA, run id; http deploy URL; newline injection; control character): each rejected, valid inputs accepted, nothing executed. This is a local test of the script text, not the GitHub run; the `reject` case on GitHub is still to do.
- Webhook server run locally: `/health` 200; forged POST with no webhook id → 503; with a webhook id and missing PayPal headers → 400. Real signature verification is not yet tested.

## 1 PayPal
- Not run yet. Script: `spikes/01-paypal.ts` ($50.00 capture, $47.50 payout, prints real capture fee and real payout fee, authorization `expiration_time`).

## 2 GitHub Actions runner
- Opus review of `verify.yml` found no high-severity issue. Applied: removed artifact upload from the untrusted `tests` job; Arbiter accepts only the artifact named `browser-screenshot`; `git fetch` hardened (`--`, hooks off, file protocol off); validation patterns made ASCII-only with `LC_ALL=C`; `CI=true`; docs no longer treat `env -i` as a security control (the test VM is assumed fully compromised by the repo under test).
- Everything else pending the live runs.

## 3 Webhook (Render Free, Virginia)
- Pending.

## 4 Gemini
- Model id checked in docs: `gemini-3.8-flash` (Free of charge, Stable). Free tier uses prompts to improve Google products.
- Live call BLOCKED: `models.get` and the generate call both returned 403 "Your API key was reported as leaked." Nothing in this repository or its git history contains the key. The key must be replaced.
- The provider layer (`lib/ai.ts`: Zod validation, one re-ask, 429 retry with backoff, cache) is unit-tested with a fake caller (13 tests pass). Only the live Gemini call is unverified.

## 5 Neon
- Connected through `DATABASE_URL`; PostgreSQL 18.6. First connect + `SELECT 1` + `SHOW server_version`: 4149 ms. Second (warm): 3275 ms. Both include a fresh TLS connection from India to us-east-1, so a new connection per request is slow; Phase 2 should reuse a connection pool. A true cold start (after 6+ idle minutes) has not been measured yet.
- `pg` printed an SSL-mode deprecation warning; set `sslmode=verify-full` explicitly in the connection string or config in Phase 2.

## Decisions for Phase 2
- Pending the remaining spikes.
