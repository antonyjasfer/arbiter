# Phase 6 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user chose native execution). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join Phase 4 (verification) and Phase 5 (payments) into one branch, close the gaps between them, remove the test-only shortcuts, and run the real flow on the live site: fund → submit → verify → report → approve → capture.

**Spec:** `CLAUDE.md`, `docs/arbiter-plan.md` (section 9), the Phase 4 and Phase 5 plans (each one's "What Phase 6 must connect"), `spikes/FINDINGS.md`, the user's Phase 6 message of 8 Nov 2026, and the user's EGM decisions of 11 Nov 2026 (revision 2, below).

**Tech Stack:** The existing `web/` stack. No new dependencies and **no migrations**.

**Revision 2 (11 Nov 2026, after the EGM Stage 9 review):**
- **EGM fixes:** all accepted except M9 (no hold list).
- **Open question 1 = allow:** TaskBoard milestone 1 may reconcile and pay out normally once PayPal completes the capture.
- **Cut for time:** Tasks 3 (Approve on the report page / Disagree / DISPUTED), 8 ("What Arbiter checked") and 9 (copy and prerender warning). The README lists them under "Known limitations".
- **Order:** 1, 2, 4, 5, 6, 7, 10, 11, 12.
- **Hard deadline:** 13 Nov 01:30 IST. **Target:** deployed and live-checked by 11 Nov 23:59 IST.

## Feature Summary

Phases 4 and 5 were built apart, and each one faked the other's half:
- Phase 4 put a milestone into FUNDED with a local script instead of PayPal.
- Phase 5 put one into REPORT_READY with a local script instead of a real verification run.

Phase 6 joins the two branches, so the only way into FUNDED is a real PayPal authorization and the only way into REPORT_READY is a real run on `arbiter-runner`. It deletes both scripts and adds a test that fails if such a shortcut comes back.

**The payment guard reads verdicts through Phase 4's `latestVerdicts`.**
- A FAIL blocks release unless the client writes an override of at least 20 characters, which is audited.
- Approval stays where Phase 5 put it, on the milestone's payment panel. Moving it to the report page is cut.

Three safety changes:
- **Money moves only on POST.**
  - Today, polling a payment with GET also reconciles it with PayPal, which can send a payout. After Phase 6, GET only reads.
  - The page asks for a reconcile with a same-origin POST, and the webhook handler still reconciles on the server.
  - The verification poll gets the same split.
- **Reset demo keeps real payments.** Today it deletes every demo project, including TaskBoard milestone 1, whose real sandbox capture `24140907B72033302` is still PENDING. After Phase 6 it keeps every project with a live PayPal payment, shows those projects in their own section below the fresh ones, and rebuilds the rest.
- **A judge can submit in one click.** Demo projects offer the three pinned demo repos (pass, fail, injection) on the submit form.

Then come a fresh security review, a deploy to `main`, and one real end-to-end payment on https://arbiter-q41f.onrender.com, plus proof that a FAIL blocks approval. Phase 7 (AG Studio) is skipped.

## Global Constraints

- **CLAUDE.md rules 1–9 hold:**
  - no AI path calls a money-moving endpoint;
  - the guard runs before every capture and payout;
  - sandbox only;
  - never fake an integration;
  - secrets are referred to by name only.
- **TaskBoard milestone 1** (capture `24140907B72033302`, CAPTURE_PENDING):
  - It may reconcile and pay out through the normal code paths (user decision, 11 Nov).
  - Never call PayPal for it by hand, and never edit its rows.
  - Its report comes from the Phase 5 test-only placeholder run (all `needs_review`, `error_code: test_only`). FINDINGS marks that report as test-only.
- **Don't press Reset demo** against the shared Neon database (local or live) until Task 6 is deployed and its tests pass.
- **Machine limits:** the machine has 8 GB of RAM.
  - Run one server at a time, and stop every server when done.
  - Run builds through PowerShell.
  - Vitest is capped at 2 workers (Task 1).
- **Every push to `main` ends with a commit that touches `web/`.** Run the secret scan before every push.
- **No migrations.** If a task seems to need one, stop and tell the user.
- **UI tests:** UI decisions are pure functions in `.ts` files with `.test.ts` tests, and components only call them. Vitest has no DOM environment and no new dependencies are allowed, so rendering is checked in the browser in Task 12.

## Review Focus

1. **Money moving from a GET:** a crawler, prefetch or `<img src>` hitting `/api/payments/:id` must never capture or pay out. After Task 4, GET makes no PayPal call at all.
2. **A forged cross-site POST:** a page on another origin posts to a reconcile route or a server action. It's refused (403) before any DB or PayPal call.
3. **Reset racing a payment:** Reset locks every demo milestone and payment row (`FOR UPDATE`) inside the demo lock before deciding what to keep.
   - A funding attempt that started earlier is kept, because its `order_pending` row is under 24 hours old.
   - One that starts after the lock waits, then fails on the deleted milestone before calling PayPal. Funding inserts the payment row before create-order (`funding.ts`).
4. **A FAIL slipping through:** a resubmission that FAILs after an earlier PASS, a run in progress, or an override of only spaces. Each goes through the guard. The guard checks the milestone state first (`not_releasable` while VERIFYING), then reads the latest completed run of the live submission.
5. **A demo-repo option on a real project:** a non-demo project shows no demo options, and the server validates a demo URL like any other submission.

---

## Implementation Plan

### Task 1: Merge both branches and cap test workers

**Files:**
- New branch `phase-6-integration` from local `main`, in a new worktree `../arbiter-p6`. Copy `.env.local` without printing it, and check it's git-ignored there.
- Merge `origin/phase-4-verification` (`f6e6642`), then `origin/phase-5-payments` (`1b500d6`). `spikes/FINDINGS.md` is the only file both changed (different sections); on a conflict, keep both sections.
- `CLAUDE.md`: Phase 4's edit to rule 4 (the browser job fetches the runner repo anonymously) comes in with the merge. Point it out in the Task 1 report.
- `web/vitest.config.ts`: `test.maxWorkers: 2`. That's the Vitest 4+ option; confirm it once in the 5.1 docs, and don't set `minWorkers`, which was removed in v4.
- `web/package.json` and `spikes/package.json`: `"test": "vitest run --maxWorkers=2"`.
- `.github/workflows/ci.yml`: the spikes job's `npx vitest run` becomes `npm test`, so both CI jobs are capped.

- [ ] Merge, resolve, commit the merge.
- [ ] Through PowerShell, one at a time, run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Expected: every test passes, 0 type errors, 0 lint errors, and the build succeeds. Record the counts.
- [ ] Commit `chore: cap vitest at 2 workers in the scripts, config and CI`.
- [ ] **Report to the user after Task 1.**

### Task 2: The guard reads Phase 4's verdicts

**Files:**
- `web/src/server/payments/verdicts.ts`: rewritten as an adapter, with its test `verdicts.test.ts`.
- `web/src/app/(app)/projects/payment-actions.ts` and `web/src/components/payments/milestone-payment.tsx`: switch to the adapter.
- Test helpers: `web/src/server/verification/test-fixtures.ts` and `web/src/server/payments/test-fixtures.ts`.

**Interfaces:**
- Consumes `latestVerdicts(db, milestoneId)` from `web/src/server/verification/report.ts`: `{ runId, verdicts: { criterionId, verdict }[], hasFail } | null`. It reads the latest **completed** run of the **live** submission.
- Produces `guardVerdicts(db): LatestVerdicts`, the `(milestoneId) => Promise<Verdict[] | null>` type from `guard.ts`.
  - The mapping is the identity, because the DB enum and `Verdict` are both `pass | fail | needs_review`.
  - It's checked at runtime, and any other value throws, so the guard fails closed.
  - `latestRunVerdicts` is deleted.

- [ ] Tests (PGlite):
  - no submission → `no_report`;
  - a newer run in progress → milestone VERIFYING → `not_releasable`;
  - a resubmission with no completed run → `no_report`;
  - a completed run with one FAIL → `fail_without_override`;
  - the same with an override of 20 or more characters → allowed, and `override_recorded` is audited;
  - an override of 25 spaces → `override_too_short`;
  - a resubmission whose new run FAILs after an older PASS → refused;
  - an unexpected verdict value (with a stubbed `latestVerdicts`) → refused.
  - **Legacy placeholder run:** build the exact shape `dev-report-ready.ts` wrote for TaskBoard milestone 1: a fixture submission and a `completed` run with `error_code: test_only`, a null plan, and every check result `needs_review`.
    - `guardVerdicts` returns all `needs_review`: not null, and no throw.
    - `getReport` renders it without throwing.

    This needs no migration and no data edit. If it did, stop and tell the user.
- [ ] Implement, run the payments and verification tests, commit `feat: payment guard reads Phase 4 latestVerdicts`.

### Task 4: Money moves only on POST

**Files:**
- New `web/src/server/http/same-origin.ts` with `same-origin.test.ts`:
  - `isAllowedOrigin(origin: string | null, expected: string): boolean`: a pure, exact match; `null` is false.
  - `expectedOrigin(h: Headers): string | null`:
    - `new URL(serverEnv().AUTH_URL).origin` when `AUTH_URL` is set;
    - otherwise, only when `process.env.NODE_ENV !== "production"`, `http://${h.get("host")}` (dev only);
    - otherwise null, which is refused.
  - `checkSameOrigin(h: Headers): boolean`. Routes pass `request.headers`; server actions pass `await headers()`.
  - Host is never trusted in production: on Render it's `localhost:10000` (FINDINGS, Phase 2).
  - Next.js also checks the Origin of server actions; cite the Next.js data-security guide at implementation time, or drop the claim.
- `web/src/server/env.ts` and `env.test.ts`: add an optional `AUTH_URL: z.url()`.
- `web/src/app/api/payments/[paymentId]/route.ts`, with a new `route.test.ts`:
  - **GET:** `getPaymentView` only, with no PayPal call.
  - **POST:**
    1. same origin, else 403 `{ error: "forbidden_origin" }`;
    2. signed in, else 401;
    3. member, else 404;
    4. then `reconcilePayment`, which returns 200 with the same `PaymentView` body. Inside the existing 30 s throttle (`reconcile.ts`, `last_reconciled_at`) it returns the stored view without a PayPal call.
- New `web/src/server/payments/payment-view.ts` with `payment-view.test.ts`: `getPaymentView(db, { userId, paymentId }): Promise<Result<PaymentView, "not_found">>`, read-only and members only, moved out of `web/src/server/payments/reconcile.ts` (modified).
- `web/src/app/api/verification-runs/[runId]/route.ts`, with a new `route.test.ts`:
  - **GET:** `getRunStatus` only.
  - **POST:** the same three checks, then a new `advanceRun(db, runner, runId, clock?, ai?)` in `web/src/server/verification/runs.ts`. It works on that run only, does nothing if the run isn't due, and the existing 240 s lease stops double work.
  - `resumeDueRuns` stays for boot only (`web/src/instrumentation-node.ts`).
- Server actions in `web/src/app/(app)/projects/payment-actions.ts` and `web/src/app/(app)/projects/verification-actions.ts`: on an origin failure, return `{ ok: false, error: "forbidden_origin" }`. The text goes in `web/src/lib/messages-payments.ts` and `web/src/lib/messages-verification.ts`.
- Clients `web/src/components/payments/release-panel.tsx` and `web/src/components/verification/verification-panel.tsx`: poll with GET. While the stored state is capture pending, payout pending or a run in progress, they also POST at most every 15 s; the server's 30 s throttle applies.

- [ ] Tests:
  - GET on a payment whose capture just completed makes no PayPal call (a fake that throws if called) and leaves the row unchanged;
  - POST with a matching Origin reconciles;
  - a missing or foreign Origin → 403 before any DB or PayPal call;
  - unauthenticated → 401;
  - non-member → 404;
  - a second POST within 30 s makes no PayPal call;
  - `AUTH_URL` unset with `NODE_ENV=production` → 403;
  - the verification GET leaves runs untouched, and its POST advances only that run;
  - `isAllowedOrigin` handles a trailing slash, another port, `null` and a scheme mismatch.
- [ ] **Grep proof**, saved in the commit message: `reconcilePayment`, `sendPayout`, `captureApproved`, `resumeDueRuns` and `advanceRun` are called only from:
  - POST handlers;
  - server actions;
  - `web/src/app/api/webhooks/paypal/route.ts`;
  - `web/src/instrumentation-node.ts`;
  - `web/src/server/payments/release.ts`;
  - `web/src/server/payments/reconcile.ts`;
  - `web/src/server/verification/runs.ts`.
- [ ] Implement, commit `fix: GET polls are read-only; reconcile only on same-origin POST`.

### Task 5: Remove the test-only paths to FUNDED and REPORT_READY

**Files:**
- Delete `web/scripts/dev-fund-milestone.ts` and `web/scripts/dev-report-ready.ts`, along with their tests and any `package.json` scripts that point at them.
- New `web/src/server/milestones/transition-callers.test.ts`.

- [ ] **Write the test first** and watch it fail while the scripts exist. It scans `web/src` and `web/scripts` (skipping `*.test.ts` and `test-fixtures.ts`):
  - Matches of `/event:\s*"(authorized|report_ready)"/` come from exactly three files:
    - `web/src/server/milestones/state-machine.ts` (the table);
    - `web/src/server/payments/funding.ts` (`authorized` only);
    - `web/src/server/verification/runs.ts` (`report_ready` only).
  - No file under `web/scripts` contains `transitionMilestone`, `milestones` or `stateVersion`.
  - Whether the move happens after a real authorize or a real run is already covered by `funding.test.ts` and `runs.test.ts`.
- [ ] Delete the scripts. Run the test (expected to pass) and the full suite.
- [ ] **Grep proof**, saved in the commit message: `git grep -nE 'event:\s*"(authorized|report_ready)"' -- web/src web/scripts ':!*.test.ts'` lists exactly those three files.
- [ ] Commit `chore: remove test-only paths to FUNDED and REPORT_READY`.

### Task 6: Reset demo keeps projects with a live PayPal payment

**Files:**
- `web/src/server/demo/seed.ts` and `seed.test.ts`.
- `web/src/app/(app)/dashboard/page.tsx`: kept projects in their own section, below the fresh projects.
- `web/src/app/(app)/dashboard/reset-demo-button.tsx`: confirm text.

**Interfaces and rules:**
- `export function isKeptPayment(p: { status: string; createdAt: Date }, now: Date): boolean`. It's true unless:
  - the status is `voided` or `authorization_lost`; or
  - the status is `order_pending` and the row is more than 24 hours old.

  A fresh `order_pending` is kept, because the buyer may still be approving in PayPal. `paid` and `payout_failed` are kept on purpose, because they record real sandbox money.
- **One transaction**, in this order:
  1. `lockDemo(tx)`.
  2. `SELECT … FOR UPDATE` on every milestone of every demo project.
  3. `SELECT … FOR UPDATE` on those milestones' payments.
  4. Compute `kept` (project IDs).
  5. `deleteDemoProjects(tx, kept)`. `P` is the demo projects not in `kept`; every subquery starts from that `P`, and the final delete is `inArray(projects.id, P)`.
  6. Create both seed projects.
  7. Audit `demo_reset` with `{ kept: kept.length }`.
- **Bug fix:** delete evidence by `run_id` as well as `check_result_id`. Phase 4's run-level evidence has a null `check_result_id`, so today a reset fails on the foreign key.
- `export async function keptDemoProjectIds(db: Db): Promise<Set<string>>` uses the same rule. The dashboard lists kept projects under the heading "Kept: has a live PayPal payment", below the fresh projects.
- Confirm text: "Reset demo deletes the demo projects and creates fresh ones. Projects with a live PayPal payment are kept."

- [ ] Tests (PGlite):
  - a TaskBoard-like project (capture ID `24140907B72033302`, milestone CAPTURE_PENDING) survives with every row, and `verifyChain` passes;
  - one test per kept status (`authorized`, `approved`, `capture_pending`, `captured`, `capture_denied`, `payout_pending`, `payout_failed`, `payout_unknown`, `paid`);
  - a 23-hour-old `order_pending` is kept, and a 25-hour-old one is deleted;
  - a project whose only payment is `voided` is deleted;
  - a project with a run and run-level evidence is deleted cleanly (this fails before the fix);
  - after a reset, there are two fresh seed projects plus the kept ones;
  - the cooldown still applies;
  - non-demo projects are never touched.
  - **Not testable here:** PGlite is a single connection, so a true race can't run in a test. The lock order is the design, Task 10 reviews it, and it's recorded as a known limitation.
- [ ] Implement, commit `fix(demo): reset keeps projects with a live PayPal payment`.

### Task 7: One-click demo repos on the submit form

**Files:**
- New `web/src/lib/demo-repos.ts` and `demo-repos.test.ts`.
- `web/src/components/verification/verification-panel.tsx`.
- `isDemo` is passed from `ws.project.isDemo` in `web/src/app/(app)/projects/[projectId]/page.tsx`, through `web/src/components/agreement/locked-milestones.tsx` and `web/src/components/verification/milestone-verification.tsx`.

**Data:** `DEMO_REPOS`: three entries `{ id: "pass" | "fail" | "injection", label, repoUrl, commitSha, deployUrl, expect }`.
- `repoUrl`: `https://github.com/antonyjasfer/arbiter-demo-{id}`.
- `commitSha`: the full 40-character SHAs of the pinned commits `06a22b8`, `134409c` and `c8c1a71` (Phase 4 FINDINGS), resolved with `git ls-remote`.
- `deployUrl`: from the Render services.
- `label` and `expect`:
  - pass: "Demo: everything works". Expect: all automatic checks pass.
  - fail: "Demo: ticking is broken". Expect: ticking a task fails on the deployed site, though its own tests pass.
  - injection: "Demo: prompt injection". Expect: text addressed to AI reviewers is flagged, and `/health` fails.
- `demoRepoOptions(isDemo: boolean)` returns `DEMO_REPOS` or `[]`.

- [ ] Tests:
  - each SHA is 40 hex;
  - each repo URL passes `submitWork`'s validator;
  - each deploy URL is https and not a private, loopback or link-local address;
  - `demoRepoOptions(false)` is empty.
  - Choosing an option fills the three fields; the user still presses "Submit and verify". This is checked in the browser in Task 12.
- [ ] Before committing, confirm each deploy URL's `/health` answers within 2 minutes (to allow for a cold start), and each SHA exists, using `git ls-remote`.
- [ ] Commit `feat: one-click demo repos on the demo submit form`.

### Task 10: Fresh-subagent security review

- [ ] Dispatch a fresh reviewer using superpowers:requesting-code-review, on the `opus` model, over `main...phase-6-integration`. Give it:
  - this plan's Review Focus 1–5;
  - CLAUDE.md rules 1–9;
  - the Phase 4 and 5 Review Focus lists.
- [ ] Fix Critical and Important findings test-first: each goes RED → GREEN, then the full suite. List the Minors for the user.
- [ ] **README:** add "Known limitations" covering:
  - the cut Tasks 3, 8 and 9:
    - no Approve on the report page;
    - no Disagree/DISPUTED flow;
    - no "What Arbiter checked" block;
    - stale "funding comes next" copy;
    - the dashboard prerender warning;
  - the untestable reset race;
  - GitHub runners' open egress.
- [ ] Re-run test, typecheck, lint and build (PowerShell, one at a time). Commit.

### Task 11: Deploy

- [ ] **Secret scan** of everything being pushed: gitleaks if available, otherwise grep for `github_pat_`, `AIza` and `-----BEGIN`, and compare each `.env.local` value in a script without printing it. Confirm `.env.local` isn't tracked, and show the result.
- [ ] Merge `phase-6-integration` into `main` with a merge commit. Push `main`, ending with a commit that touches `web/`. Then check:
  - CI: both jobs green;
  - the Render deploy is live;
  - `/api/health?db=1` → 200.
- [ ] **Render env vars, by name only:** compare the service's names with `serverEnv`'s schema (which includes `AUTH_URL` and `DEMO_MODE`). Report missing names to the user.
- [ ] **DEMO_MODE:** once the Task 6 deploy is live and a signed-in demo client sees kept projects in their own section, tell the user it's safe to set `DEMO_MODE=true` and redeploy. If it's already `true`, say so.
- [ ] **Report to the user** (Render step).

### Task 12: Live end to end, recorded in FINDINGS

Run this on https://arbiter-q41f.onrender.com, one browser at a time. The user approves the PayPal popup as the client's sandbox buyer; Claude never types the buyer's credentials. **Report to the user at each PayPal approval.**

- [ ] **Setup:**
  1. Press Reset demo as the demo client. The kept TaskBoard stays in its own section.
  2. On the fresh TaskBoard, approve version 1 as the demo client, then as the demo freelancer. Its milestones become AGREED.
  3. As the demo client, create a second demo project with the one-milestone brief used in Phase 4 Task 9 (Phase 4 FINDINGS). Compile it, and have both parties approve it.
- [ ] **Pass flow** (fresh TaskBoard milestone 1):
  1. Fund it; the user approves in PayPal.
  2. As the freelancer, choose "Demo: everything works" and submit.
  3. Verification runs; the report loads.
  4. The client approves → capture. Then either:
     - capture status COMPLETED → milestone RELEASED → payout sent → milestone PAID; or
     - capture PENDING → milestone CAPTURE_PENDING, with the copy `PayPal is settling this payment; Arbiter pays the freelancer once it completes.`
- [ ] **Fail flow** (the second project's milestone):
  1. Fund it; the user approves in PayPal.
  2. Submit "Demo: ticking is broken".
  3. The report shows the tick FAIL.
  4. Approving without an override is refused with `fail_without_override`, shown as `A check failed. To release anyway, write why (at least 20 characters).`
  5. Stop: no override, so no second capture.
  6. Optionally, Cancel via the existing button, which voids the hold.
- [ ] **FINDINGS "Phase 6 live checks":**
  - order, authorization, capture and payout IDs; run URLs; timings;
  - which state changes came from webhooks and which from POST reconcile;
  - the refused-approval message;
  - a note that TaskBoard milestone 1's report is the Phase 5 **test-only** placeholder (no verification ran).

  Commit and push, ending with a `web/` change, or deploy by hand if the push is docs-only.
- [ ] **Final report to the user:** files changed, features completed, tests run with real results, known limitations, and manual steps. Then stop.
