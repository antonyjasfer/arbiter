# Phase 2 Foundation Implementation Plan

> **Status (3 Nov 2026 IST): complete, awaiting the user's approval.** Tasks 1–9 done; live at https://arbiter-q41f.onrender.com with GitHub sign-in. Results in `spikes/FINDINGS.md`, section "Phase 2 live checks".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Next.js app on the existing Render Free service where a user signs in with GitHub. It has the full database schema migrated on Neon, the milestone state machine, a role-check helper, the PayPal webhook moved into the app with de-duplication, and green CI.

**Architecture:** A new Next.js 16 App Router app lives in `web/` (the repo keeps `spikes/` alongside it). All server code is in `web/src/server/**`, which client components never import. The database is Neon Postgres through Drizzle; tests run the same migrations against PGlite (in-process Postgres), so CI needs no database or secrets. Auth.js v5 uses JWT sessions with no adapter tables. Project roles come from `project_members` in the database, never from the role switcher. The webhook route verifies with PayPal, stores each event once and reads the resource back from PayPal. No money-moving PayPal endpoint exists anywhere in Phase 2.

**Tech Stack:** Node 24, Next.js 16.4.4, React 19.3.1, TypeScript strict, Tailwind 4.3.4 + shadcn 4.23.0, Drizzle ORM 0.45.4 / drizzle-kit 0.31.11, pg 8.23.1, @electric-sql/pglite 0.5.14 (tests), next-auth 5.0.0-beta.32, Zod 4.6.7, Vitest 5.1.0, ESLint 10.14.0 + eslint-config-next 16.4.4.

**Spec:** `docs/arbiter-plan.md` (sections R2, R, 5, 7, 9 "Phase 2"), `CLAUDE.md`, `spikes/FINDINGS.md`, and the user's Phase 2 message of 3 Nov 2026.

## Global Constraints

- Finish by end of Tue 4 Nov IST. Work on branch `phase-2-foundation`, and merge to `main` only in Task 9 (Render auto-deploys `main`).
- Zero budget: Render Free (Virginia) service `arbiter` (`srv-dbkgc3142hec738qh3r0`), Neon free tier, GitHub Actions free tier. No new paid service and no second Render service.
- Pin exact versions as listed in Tech Stack, with no `^`. Node `24` in `.node-version` and `"engines": {"node": ">=24 <27"}`.
- TypeScript `strict: true` and `noUncheckedIndexedAccess: true`. No `any`. Zod at every boundary (env, route bodies, PayPal responses).
- Money is `numeric(12,2)` read as a string (Drizzle `mode: "string"`) and is never stored or computed as a float. Currency is `text` and defaults to `'USD'`.
- IDs are `uuid` with `defaultRandom()`, because they appear in URLs and must not be guessable. Timestamps are `timestamptz`.
- The `DATABASE_URL` app connection uses the Neon **pooled** host with `sslmode=verify-full` set in code. Migrations use the direct host (the same URL with `-pooler` removed from the hostname).
- Phase 2 calls only these PayPal endpoints: `POST /v1/oauth2/token`, `POST /v1/notifications/verify-webhook-signature`, the read-only `GET` endpoints, and, in `register-webhook.ts` only, `GET` / `POST` / `PATCH /v1/notifications/webhooks`. The server refuses to start unless `PAYPAL_ENVIRONMENT === "SANDBOX"`.
- Secrets live only in `.env.local` and the Render dashboard. Code, logs and errors name variables, never values. Webhook logs carry event id, type and verification status only.
- Every PayPal write call sends a `PayPal-Request-Id`. That applies to `register-webhook.ts` create and patch; the verify postback is not a write to PayPal state.
- Before every push: run the secret scan (patterns plus `.env.local` values), confirm `.env.local` is untracked, show the result, then push.
- Auth callback URL (Auth.js v5 default `basePath` `/api/auth`, provider id `github`): `https://arbiter-q41f.onrender.com/api/auth/callback/github`.

## Review Focus

1. **A webhook body with non-ASCII characters or unusual whitespace.** The route must pass `await request.text()` to the verify builder byte for byte. Test: a body containing `"é"` and `"\n  "` appears verbatim in the built verify body (Task 6).
2. **The same PayPal event delivered twice at the same time.** This must produce exactly one `webhook_events` row, and both requests return 200. Test: two concurrent `recordEvent` calls with one event id give one row, with `inserted: true` once and `false` once (Task 6).
3. **A freelancer who sets the role switcher to "client", or a removed member.** Server-side checks read `project_members` and ignore the cookie. Test: `requireProjectRole` denies a user whose cookie says client but whose row says freelancer, and denies a user with no row (Task 5).
4. **Two transitions racing on the same milestone version.** Exactly one wins and the other gets `{ ok: false, error: "conflict" }`. Test against PGlite (Task 4).
5. **A missing or blank env var on Render.** Boot fails with the variable names only, never values. Test: `parseServerEnv` with a missing `AUTH_SECRET` and a blank `DATABASE_URL` throws a message that contains both names and none of the supplied values (Task 1).

---

### Task 1: Scaffold `web/`, env schema, Vitest, ESLint

**Files:**
- Create: `web/` from `create-next-app@16.4.4` (App Router, TS, Tailwind, ESLint, `src/` dir, import alias `@/*`, no Turbopack opt-out), then pin all versions exactly.
- Create: `web/.node-version`, `web/vitest.config.ts`, `web/src/server/env.ts`, `web/src/server/env.test.ts`
- Modify: `web/package.json` scripts: `dev`, `build`, `start` (`next start -p ${PORT:-3000}`), `lint` (`eslint .`, since Next 16 has no `next lint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `db:generate`, `db:migrate`
- Modify: root `.gitignore` adds `web/.next/`, `web/node_modules/`

**Interfaces:**
- Produces: `parseServerEnv(source: Record<string, string | undefined>): ServerEnv` and `serverEnv(): ServerEnv` (memoized, reads `process.env`). `ServerEnv` keys: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT` (literal `"SANDBOX"`), `PAYPAL_WEBHOOK_ID` (optional; the webhook route returns 503 when it is absent). Error class `EnvError` with `names: string[]`.
- Local dev loads the repo-root `.env.local` through `next.config.ts` (`loadEnvConfig` on the parent directory), so there is still one secrets file.

- [ ] Step 1: Scaffold, pin versions, run `npm run build` once. Expected: build succeeds.
- [ ] Step 2: Write `env.test.ts`. Tests: valid input parses; `PAYPAL_ENVIRONMENT: "LIVE"` throws mentioning `PAYPAL_ENVIRONMENT`; missing `AUTH_SECRET` plus blank `DATABASE_URL` gives `EnvError.names` equal to `["AUTH_SECRET","DATABASE_URL"]` (sorted), and `message` does not contain the other supplied values (Review Focus 5).
- [ ] Step 3: Run `npm test`. Expected: FAIL (module missing).
- [ ] Step 4: Implement `env.ts` with Zod; the error lists names only.
- [ ] Step 5: Run `npm test && npm run lint && npm run typecheck`. Expected: all pass.
- [ ] Step 6: Commit `feat(web): scaffold Next.js app with env schema`.

### Task 2: Design tokens and app shell

**Files:**
- Create: `web/DESIGN.md` (one page: palette, type scale, spacing, radius, and what each token is for), tokens as CSS variables in `web/src/app/globals.css` (Tailwind v4 `@theme`, light and dark), shadcn `init` plus components `button`, `card`, `badge`, `dropdown-menu`, `avatar`, `separator`
- Create: `web/src/app/page.tsx` (landing: what Arbiter does in one line, the three differentiators, the "Sign in with GitHub" button, and the honesty notes from CLAUDE.md scope reminders: sandbox only, not a licensed escrow service)
- Create: `web/src/app/(app)/layout.tsx` (signed-in shell: header with avatar, sign-out, role switcher), `web/src/app/(app)/dashboard/page.tsx` (skeleton: empty "Your projects" card with a disabled "New project" button labelled "Phase 3")
- Create: `web/src/lib/active-role.ts` + `active-role.test.ts`, `web/src/components/role-switcher.tsx`

**Interfaces:**
- Produces: `type ActiveRole = "client" | "freelancer"`; `parseActiveRole(cookie: string | undefined): ActiveRole` (default `"client"`; any other value gives `"client"`); cookie name `arbiter_role`. The role switcher only changes which view is shown. Permission checks never read it (see Task 5).
- Design-system skill: tokens and `DESIGN.md` only. Skip the competitor research and the preview page (time). Avoid the "AI slop" list: no gradients or glass cards. Use one accent colour and a status colour set (pass, fail, review, pending) for verdicts later.

- [ ] Step 1: Test `parseActiveRole`: `undefined` gives client, `"freelancer"` gives freelancer, `"admin"` gives client, `"FREELANCER"` gives client.
- [ ] Step 2: Run, expect FAIL. Implement. Run, expect PASS.
- [ ] Step 3: Build the pages. `npm run build` passes; `npm run dev` shows the landing page and `/dashboard` redirects to sign-in (wired in Task 5; until then it renders).
- [ ] Step 4: Commit `feat(web): design tokens and app shell`.

### Task 3: Database: driver decision, schema, first migration

**Files:**
- Create: `web/scripts/db-bench.ts` (local measurement: for `pg` Pool and for `@neondatabase/serverless`, both the HTTP `neon()` and the WebSocket `Pool`: first connect+query, the median of 10 warm `SELECT 1`, and one interactive transaction; prints ms only). Records the results and the decision in `web/docs/db-driver.md`.
- Create: `web/src/server/db/schema.ts`, `web/src/server/db/client.ts`, `web/drizzle.config.ts`, `web/drizzle/0000_*.sql` (generated), `web/src/server/db/test-db.ts`, `web/src/server/db/schema.test.ts`
- Driver decision rule: the app runs as a long-lived Node process on Render in Virginia, next to Neon us-east-1. So TCP connections are reused through a `pg` Pool, and Tasks 4 to 6 need interactive transactions (guarded update plus audit append). Unless the benchmark shows `pg` warm queries slower than the serverless driver's WebSocket Pool by more than 20%, pick **`pg`** (`drizzle-orm/node-postgres`). The serverless driver's advantage, avoiding a TCP handshake per cold invocation, applies to serverless and edge functions, which we do not use. Benchmarks from India overstate latency for both; compare ratios, not absolute numbers.

**Interfaces:**
- Produces: `db` (Drizzle instance; `Pool` with `max: 5`, created lazily on first use so `/api/health` does not touch Neon); `appDatabaseUrl(raw: string): string` (sets `sslmode=verify-full`, keeps the pooled host); `directDatabaseUrl(raw: string): string` (removes `-pooler` from the hostname, sets `sslmode=verify-full`); `createTestDb(): Promise<{ db: TestDb; close(): Promise<void> }>` (PGlite plus the generated migrations, for tests).
- Produces the tables (section 7 plus Rev 2), in snake_case. Every table has `created_at`.
  - `users` (github_id text unique not null, login, name, email null, avatar_url, paypal_email null)
  - `projects` (title, created_by → users)
  - `project_members` (project_id, user_id, role enum `client|freelancer`, unique (project_id, user_id))
  - `invitations` (project_id, role, token_hash unique, expires_at, accepted_at null, accepted_by null)
  - `agreements` (project_id, current_version int, status enum `draft|approved|locked`)
  - `agreement_versions` (agreement_id, version, body_json jsonb, client_approved_at, freelancer_approved_at, hash, unique (agreement_id, version))
  - `milestones` (agreement_version_id, position, title, amount numeric(12,2), currency, due_at null, state enum from Task 4, state_version int default 0)
  - `acceptance_criteria` (milestone_id, kind enum `test|browser|static|review`, text, spec_json jsonb, weight int default 1)
  - `submissions` (milestone_id, repo_url, commit_sha char(40), deploy_url, submitted_by)
  - `verification_runs` (submission_id, status enum `queued|running|completed|errored`, workflow_run_id bigint null, run_url null, started_at, finished_at)
  - `check_results` (run_id, criterion_id, verdict enum `pass|fail|needs_review`, source enum `deterministic|ai`, confidence numeric(3,2) null, summary)
  - `evidence` (check_result_id, type enum `log|screenshot|diff`, uri, sha256)
  - `disputes` (milestone_id, author_id, comment text, created_at; Rev 2 "Disagree" comments)
  - `payments` (milestone_id, paypal_order_id, authorization_id, capture_id, payout_batch_id, status text, amount numeric(12,2), request_ids jsonb)
  - `webhook_events` (paypal_event_id unique, event_type, resource_type, resource_id, verified bool, payload_sha256, received_at, reconciled_status null, reconciled_at null)
  - `audit_events` (project_id, actor_id null, action, data jsonb, prev_hash null, hash unique)
- Add an index on every foreign key (postgres-patterns "unindexed foreign keys"), plus `milestones (state)`.
- Migrations are forward-only (generated by `drizzle-kit generate`, applied by `drizzle-kit migrate`, never `push`).

- [ ] Step 1: Run `db-bench.ts` against Neon. Write the numbers and the decision in `web/docs/db-driver.md`.
- [ ] Step 2: Test `appDatabaseUrl` / `directDatabaseUrl`: for `postgres://u:p@ep-x-pooler.c-1.us-east-1.aws.neon.tech/db?sslmode=require&channel_binding=require`, the app URL keeps `-pooler` with `sslmode=verify-full` and keeps `channel_binding=require`; the direct URL has the host `ep-x.c-1.us-east-1.aws.neon.tech`.
- [ ] Step 3: Test `schema.test.ts` on PGlite: migrations apply; inserting two `project_members` rows with the same (project, user) fails with a unique violation; inserting two `webhook_events` with the same `paypal_event_id` fails; inserting `amount` `"50.00"` reads back as the string `"50.00"`.
- [ ] Step 4: Run, expect FAIL. Implement the schema and client, generate the migration, run, expect PASS.
- [ ] Step 5: Apply to Neon with `npm run db:migrate` (direct URL). Then verify with a read-only query that lists the 16 tables plus `__drizzle_migrations`.
- [ ] Step 6: Commit `feat(db): schema, driver decision, first migration`.

### Task 4: Milestone state machine and guarded transition

**Files:**
- Create: `web/src/server/milestones/state-machine.ts`, `state-machine.test.ts`, `web/src/server/milestones/transition.ts`, `transition.test.ts`

**Interfaces:**
- Produces: `MILESTONE_STATES` (readonly tuple, also used for the pg enum in Task 3): `DRAFT, AGREED, FUNDED, SUBMITTED, VERIFYING, REPORT_READY, APPROVED, CAPTURE_PENDING, RELEASED, PAID, DISPUTED, CANCELLED`. Type `MilestoneState`.
- `TRANSITIONS: readonly { from: MilestoneState; event: MilestoneEvent; to: MilestoneState; actor: "client" | "freelancer" | "both" | "system" }[]`. These are the only rows:

| from | event | to | actor |
|---|---|---|---|
| DRAFT | both_approved | AGREED | both |
| AGREED | authorized | FUNDED | system |
| FUNDED | authorization_lost | AGREED | system |
| FUNDED | cancel | CANCELLED | client |
| FUNDED | submit | SUBMITTED | freelancer |
| SUBMITTED | start_verification | VERIFYING | system |
| VERIFYING | report_ready | REPORT_READY | system |
| VERIFYING | run_errored | SUBMITTED | system |
| REPORT_READY | resubmit | SUBMITTED | freelancer |
| REPORT_READY | approve | APPROVED | client |
| REPORT_READY | disagree | DISPUTED | both |
| DISPUTED | approve | APPROVED | client |
| DISPUTED | cancel | CANCELLED | client |
| APPROVED | capture_completed | RELEASED | system |
| APPROVED | capture_pending | CAPTURE_PENDING | system |
| CAPTURE_PENDING | capture_completed | RELEASED | system |
| CAPTURE_PENDING | capture_denied | APPROVED | system |
| RELEASED | payout_succeeded | PAID | system |

New against section 7: `FUNDED→AGREED` (authorization expired or voided by PayPal, must re-fund), `VERIFYING→SUBMITTED` (runner infrastructure error, so a retry is allowed), and the three `CAPTURE_PENDING` rows (Phase 1 finding). `capture_denied` returning to `APPROVED` lets the client retry or cancel in Phase 5; re-check this with PayPal behaviour then. Phase 5 note (user, 3 Nov): an authorization can also be lost while SUBMITTED, VERIFYING, REPORT_READY or DISPUTED; Phase 5 designs that path (e.g. an "authorization lost, re-fund needed" state). Do not add those transitions in Phase 2.
- `nextState(from: MilestoneState, event: MilestoneEvent): Result<MilestoneState, "illegal_transition">` with `type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }` (exported from `web/src/lib/result.ts`).
- `transitionMilestone(db, args: { milestoneId: string; expectedState: MilestoneState; expectedVersion: number; event: MilestoneEvent }): Promise<Result<{ state: MilestoneState; stateVersion: number }, "illegal_transition" | "conflict">>`. It runs one `UPDATE … SET state = $to, state_version = state_version + 1 WHERE id = $id AND state = $expected AND state_version = $n RETURNING`. Zero rows returns `conflict`.

- [ ] Step 1: `state-machine.test.ts`: each table row returns its `to`; every other (state, event) pair returns `illegal_transition` (loop over all states × events; the count of legal pairs equals 18); `PAID` and `CANCELLED` have no outgoing transitions; there is no path from `APPROVED` to `PAID` that avoids `RELEASED` (this guards the "payout waits for COMPLETED capture" rule).
- [ ] Step 2: `transition.test.ts` (PGlite): a legal move increments `state_version`; a wrong `expectedState` gives `conflict`; two concurrent calls with the same version give exactly one `ok` (Review Focus 4); an illegal event never runs SQL (the row is unchanged).
- [ ] Step 3: Run, expect FAIL. Implement. Run, expect PASS.
- [ ] Step 4: Commit `feat(milestones): typed transition table and guarded update`.

### Task 5: Auth.js with GitHub, and the role-check helper

**Files:**
- Create: `web/src/auth.ts` (NextAuth config), `web/src/app/api/auth/[...nextauth]/route.ts`, `web/src/proxy.ts` (Next 16 name for middleware; protects `/dashboard` and `/projects/**`), `web/src/server/auth/upsert-user.ts` + test, `web/src/server/auth/roles.ts` + test

**Interfaces:**
- `next-auth@5.0.0-beta.32` (v5 is App Router native with `auth()`, and reads `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_SECRET` by name; v4 stable lacks `auth()`). Use JWT session strategy and no adapter. The `jwt` callback calls `upsertGithubUser` on sign-in and stores our `users.id` as `token.uid`. The `session` callback exposes `session.user.id`. `trustHost: true` (Render terminates TLS).
- `upsertGithubUser(db, profile: { id: number | string; login: string; name?: string | null; email?: string | null; avatar_url?: string | null }): Promise<{ id: string }>`, idempotent on `github_id` and updating login, name and avatar.
- `requireUser(): Promise<Result<{ userId: string }, "unauthenticated">>`.
- `requireProjectRole(db, args: { userId: string; projectId: string; allowed: readonly ("client" | "freelancer")[] }): Promise<Result<{ role: "client" | "freelancer" }, "not_member" | "forbidden">>`. Reads `project_members` only.

- [ ] Step 1: `upsert-user.test.ts` (PGlite): the first call inserts; a second call with a changed login updates the same row (same id); numeric and string GitHub ids map to the same row.
- [ ] Step 2: `roles.test.ts` (PGlite): a client member is allowed `["client"]`; a freelancer is denied `["client"]` with `forbidden` even when called right after `parseActiveRole("client")` (Review Focus 3); a non-member gets `not_member`; a member of project A gets `not_member` for project B.
- [ ] Step 3: Run, expect FAIL. Implement. Run, expect PASS.
- [ ] Step 4: Wire the sign-in button and the sign-out action; `/dashboard` shows `session.user` name and avatar. `npm run build` passes.
- [ ] Step 5: Commit `feat(auth): GitHub sign-in and server-side role checks`.

### Task 6: PayPal webhook route `/api/webhooks/paypal`

**Files:**
- Create: `web/src/server/paypal/client.ts` (`getAccessToken`, `ppGet<T>(path, schema)`, `verifyWebhookSignature(body: string)`; host `https://api-m.sandbox.paypal.com` only; no write helpers), `web/src/server/paypal/webhook-verify.ts` + test (moved from `spikes/03-webhook/verify.ts` and its tests, unchanged behaviour), `web/src/server/paypal/webhook-store.ts` + test, `web/src/server/paypal/reconcile.ts` + test, `web/src/app/api/webhooks/paypal/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`), `web/src/app/api/health/route.ts`

**Interfaces:**
- `buildVerifyBody(headers, rawBody, webhookId): string`, the same as the spike.
- `recordEvent(db, e: { paypalEventId: string; eventType: string; resourceType: string; resourceId: string; payloadSha256: string }): Promise<{ inserted: boolean; id: string }>`. Uses `INSERT … ON CONFLICT (paypal_event_id) DO NOTHING RETURNING`; on conflict it selects the existing id.
- `resourcePathFor(resourceType: string, resourceId: string): string | null`. Values: `capture` → `/v2/payments/captures/{id}`, `authorization` → `/v2/payments/authorizations/{id}`, `checkout-order` → `/v2/checkout/orders/{id}`, `payouts` → `/v1/payments/payouts/{id}`, `payouts_item` → `/v1/payments/payouts-item/{id}`, anything else → null. The `resource_type` strings are confirmed against the five real events from Phase 1 in the Render log / webhooks-events API before coding.
- `reconcileEvent(db, eventRowId, fetcher): Promise<void>`. GETs the resource (read-only) and stores `reconciled_status` (the resource's `status`, or `batch_header.batch_status` for payouts) and `reconciled_at`. The status is `"unsupported"` when no path exists and `"error"` on fetch failure. **It never changes milestone state in Phase 2** (that is Phase 5).
- Route contract: no `PAYPAL_WEBHOOK_ID` → 503; missing headers or empty body → 400; PayPal says not `SUCCESS` → 400 and nothing is stored; verified and new → store, reconcile, 200; verified duplicate → 200 with no second reconcile; DB error → 500 (PayPal retries). Order-independent: the handler never reads earlier events and always takes current state from PayPal.
- `/api/health` → `{ ok: true, uptimeSeconds }` with no DB access; `/api/health?db=1` also runs `SELECT 1`.

- [ ] Step 1: Copy the spike's verify tests and add: a body containing `é` and `"\n  "` appears verbatim in the output (Review Focus 1).
- [ ] Step 2: `webhook-store.test.ts` (PGlite): first insert `inserted: true`; the same id again `inserted: false` with the same row id; two concurrent inserts give one row (Review Focus 2).
- [ ] Step 3: `reconcile.test.ts` with a fake fetcher: each mapping above; an unknown type stores `unsupported` without calling the fetcher; a fetcher error stores `error`; the order of two events for one capture does not change the stored result (each stores its own fetched status).
- [ ] Step 4: Route test (call the exported `POST` with a `Request`; inject a fake verifier and the PGlite db through a small `deps` parameter): the 503, 400, 400 (FAILURE), 200 new and 200 duplicate cases above.
- [ ] Step 5: Run, expect FAIL. Implement. Run, expect PASS.
- [ ] Step 6: Commit `feat(webhooks): verified, de-duplicated PayPal webhook with reconcile-by-fetch`.

### Task 7: Point the existing webhook at the new path

**Files:**
- Modify: `spikes/03-webhook/register-webhook.ts`, `spikes/lib/paypal.ts` (`ppFetch` accepts `"PATCH"`)
- Create: `spikes/03-webhook/register-plan.ts` + `register-plan.test.ts`

**Interfaces:**
- `planRegistration(args: { existing: { id: string; url: string; eventTypes: string[] }[]; storedId?: string; targetUrl: string; wanted: string[] }): { action: "reuse" | "patch" | "create"; id?: string; patch?: { op: "replace"; path: "/url" | "/event_types"; value: unknown }[] }`
- Rules: a webhook already at `targetUrl` with all wanted events gives `reuse`. Otherwise `storedId` found in `existing` gives `patch` (url and/or event types, only what differs). Otherwise `create`. The new default URL is `https://arbiter-q41f.onrender.com/api/webhooks/paypal`. PATCH sends a `PayPal-Request-Id`, and the script reads the webhook back after patching (as it does now). The webhook id does not change, so `.env.local` and Render keep the same `PAYPAL_WEBHOOK_ID`.

- [ ] Step 1: Tests: reuse; patch url only; patch url and event types; create when storedId is unknown; never `create` while a webhook with `storedId` exists.
- [ ] Step 2: Run, expect FAIL. Implement. Run `cd spikes && npx vitest run && npx tsc --noEmit`, expect PASS.
- [ ] Step 3: Commit `feat(spikes): register-webhook patches the existing webhook URL`. (Run the script against PayPal in Task 9, after the app is live.)

### Task 8: CI, LICENSE, README, .env.example, CLAUDE.md names

**Files:**
- Create: `.github/workflows/ci.yml`, `LICENSE` (MIT, "Copyright (c) 2026 Antony Jasfer"), `README.md` (skeleton: what it is, honesty notes, architecture in five lines, local setup, test commands, deploy, known limits including open runner egress and PayPal platform approval), `.env.example` (every name from `.env.local` plus `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, with empty values and a one-line comment each)
- Modify: `CLAUDE.md` rule 7 env-name list (add the three `AUTH_*` names) and the P1 line (Rev 2 cuts). This is your file; the plan only touches those two lines.

**Interfaces:**
- CI: `on: push` (branches `main`, `phase-*`) and `pull_request`. `permissions: contents: read` at the top level. No secrets and no artifacts. Job `web` (working-directory `web`): `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (with dummy non-secret env values so `next build` can run). Job `spikes`: `npm ci`, `npx tsc --noEmit`, `npx vitest run`. Use `actions/checkout` and `actions/setup-node` at their current major (checked at the time) with `node-version-file: web/.node-version` and npm cache.

- [ ] Step 1: Write the files. Run every CI command locally in both folders; expect all pass.
- [ ] Step 2: Commit `chore: CI, MIT license, README skeleton, .env.example`.

### Task 9: Review, merge, deploy, live checks

**Files:**
- Create: `render.yaml` (service `arbiter`: `type: web`, `runtime: node`, `plan: free`, `region: virginia`, `rootDir: web`, `buildCommand: npm ci && npm run build`, `startCommand: npm run start`, `healthCheckPath: /api/health`, `autoDeploy: true`, branch `main`. Secret env vars declared with `sync: false`. `PAYPAL_ENVIRONMENT: SANDBOX` and `NODE_VERSION: 24` declared with values.) Before relying on it, check Render's Blueprint docs on whether syncing a Blueprint adopts an existing dashboard-created service of the same name. If it would create a second service, keep `render.yaml` as the declared config, apply the same settings in the dashboard, and say so in the README.

- [ ] Step 1: Fresh-subagent code review with `superpowers:requesting-code-review` on Tasks 4–6 (state machine, role helper, webhook). Fix findings, re-run all tests.
- [ ] Step 2: Full local verification: `web`: lint, typecheck, test, build; `spikes`: tsc, vitest. Read the output.
- [ ] Step 3: Secret scan, show the result, merge `phase-2-foundation` into `main`, push. CI must go green on GitHub (check the run).
- [ ] Step 4: **User, in the Render dashboard** for service `arbiter`:
  - Root Directory `web`, Build Command `npm ci && npm run build`, Start Command `npm run start`, Health Check Path `/api/health`.
  - Add env vars: `AUTH_SECRET` (generate with `npx auth secret` locally; it writes to `.env.local`, then copy it in), `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `DATABASE_URL` (the same pooled URL as `.env.local`), `NODE_VERSION=24`.
  - Keep the existing `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT=SANDBOX`, `PAYPAL_WEBHOOK_ID`.
  - In the GitHub OAuth app, Authorization callback URL `https://arbiter-q41f.onrender.com/api/auth/callback/github`.
- [ ] Step 5: Live checks (curl, read-only):
  - `/api/health` 200.
  - `/api/health?db=1` 200.
  - `/api/auth/providers` lists `github`.
  - `GET /api/auth/signin/github` (with the CSRF form flow) redirects to `github.com/login/oauth/authorize` with `redirect_uri=https://arbiter-q41f.onrender.com/api/auth/callback/github`.
  - A forged webhook POST gets 400.
  - The old path `/webhook` gets 404.
- [ ] Step 6: Run `register-webhook.ts` to patch the webhook URL; the read-back shows the new URL and 7 event types.
- [ ] Step 7: Real-event check:
  1. Run `npx tsx 01-paypal.ts --probe` ($5.00, authorize then void; **you approve one sandbox payment**).
  2. Expect `PAYMENT.AUTHORIZATION.CREATED` and `.VOIDED` stored once each with `verified = true`, plus a `reconciled_status`.
  3. Then `POST /v1/notifications/webhooks-events/{id}/resend` for one of them (read and resend only, not money-moving). The row count stays the same and the Render log shows the duplicate path.
- [ ] Step 8: **You sign in with GitHub** on the live URL (I do not enter credentials). I confirm your `users` row exists with a read-only query.
- [ ] Step 9: Update `spikes/FINDINGS.md` / plan section 9 status, commit, scan, push. Report: live URL, test counts from real runs, limitations, manual steps.

---

## Self-review notes

- **Spec coverage:**
  - User items 1–6 map to Tasks 1–2, 3–4, 5, 6–7, 9 and 8.
  - Section 7 tables: all 16, with `disputes` reused for the Rev 2 comments.
  - CAPTURE_PENDING is in Task 4. Neon pooled with explicit sslmode and the driver evaluation are in Task 3.
  - Tests named in section 9 Phase 2 (role-check helper, state-machine table) are in Tasks 4–5.
- **Not in Phase 2:** money-moving PayPal routes, the payment guard, the audit chain logic (the table exists; hashing is Phase 3), invitations UI (Phase 3).
- **Risk:** Next 16 build on Render Free may be slow or run out of memory. If the build fails, set `NODE_OPTIONS=--max-old-space-size=460` and retry before changing anything else.
