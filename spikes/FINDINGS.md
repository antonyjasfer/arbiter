# Phase 1 Findings (in progress, started 2026-10-29)

| Spike | Result | Date run |
|---|---|---|
| 1 PayPal authorize/capture/payout | NOT COMPLETE: first attempt timed out waiting for buyer approval (order created, nothing authorized or captured) | 2026-10-29 |
| 2 GitHub Actions runner | NOT RUN (needs pushes to `arbiter-spike-fixture` and `arbiter-runner`, and the `SPIKE_CANARY` secret) | |
| 3 Webhook verify (Render Free) | NOT RUN (needs the repo on GitHub and a Render deploy) | |
| 4 Gemini structured output | PASS on `gemini-3.6-flash` (3.8 overloaded) | 2026-10-29 |
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
- Pending the remaining spikes.
