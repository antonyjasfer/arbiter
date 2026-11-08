# Phase 6 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join Phase 4 (verification) and Phase 5 (payments) into one branch, close the gaps between them, remove every test-only shortcut, and run the real flow on the live site: fund → submit → verify → report → approve → capture.

**Spec:** `CLAUDE.md`, `docs/arbiter-plan.md` (section 9), the Phase 4 and Phase 5 plans (each one's "What Phase 6 must connect"), `spikes/FINDINGS.md`, and the user's Phase 6 message of 8 Nov 2026 (items 1–11 below).

**Tech Stack:** The existing `web/` stack. No new dependencies and **no migrations**: audit actions are a TypeScript list and the `disputes` table already exists.

## Feature Summary

Phases 4 and 5 were built apart and each one faked the other's half: Phase 4 put a milestone into FUNDED with a local script instead of PayPal, and Phase 5 put one into REPORT_READY with a local script instead of a real verification run. Phase 6 joins the two branches, so the only way to FUNDED is a real PayPal authorization and the only way to REPORT_READY is a real run on `arbiter-runner`. It deletes both scripts and adds a test that fails if anyone adds such a shortcut again.

It then wires the two halves together:
- **The payment guard** reads verdicts through Phase 4's `latestVerdicts`. A FAIL blocks release unless the client writes an override of at least 20 characters, and the override is audited.
- **Approve** lives on the report page, where the client sees the evidence. **Disagree** records a comment and moves the milestone to DISPUTED, from which the client can still approve (same guard) or cancel (which voids the PayPal hold).

Four safety changes:
- **Money moves only on POST.** Today, polling a payment with GET also reconciles it with PayPal and can send a payout. After Phase 6, GET only reads. The page asks for a reconcile with a same-origin POST; the server's webhook handler still reconciles too. The verification poll gets the same split.
- **Reset demo keeps real payments.** Today it deletes every demo project, including TaskBoard milestone 1, whose real sandbox capture `24140907B72033302` is still PENDING. After Phase 6 it keeps any project that has a live PayPal payment and rebuilds the rest.
- **A judge can submit in one click:** demo projects offer the three pinned demo repos (pass, fail, injection) on the submit form.
- **The report says what Arbiter checked** for each criterion, in plain words, before showing the result.

Finally, small copy and warning fixes, a fresh security review, a deploy to `main`, and one real end-to-end payment on https://arbiter-q41f.onrender.com, plus proof that a FAIL blocks approval. Phase 7 (AG Studio) is skipped.

## Global Constraints

- **CLAUDE.md rules 1–9 hold.** In particular: no AI path calls a money-moving endpoint; the guard runs before every capture and payout; sandbox only; never fake an integration; secrets by name only.
- **Hands off TaskBoard milestone 1:** don't call PayPal for it, don't run a reconcile against it, and don't change its rows (capture `24140907B72033302`, CAPTURE_PENDING). Don't open its project page on the live site while Task 4's POST reconcile is live, unless the user says so (see Open questions).
- **Don't press Reset demo** anywhere that writes to the shared Neon database (local or live) until Task 6 is deployed and its test is green.
- **The machine has 8 GB of RAM:** run one server at a time, run builds through PowerShell, and stop every server when done. Vitest is capped at 2 workers (Task 1).
- **Every push to `main` ends with a commit that touches `web/`** (Render auto-deploy). Run the secret scan before every push to a public repo.
- **No migrations.** If a task seems to need one, stop and tell the user.
- **Target:** end of 9 Nov IST.

## Review Focus

1. **Money moving from a GET:** a crawler, prefetch or `<img src>` hitting `/api/payments/:id` must never capture or pay out. After Task 4, GET makes no PayPal call at all.
2. **A forged cross-site POST:** a page on another origin posts to the reconcile route or a server action. It's refused (403) before any DB or PayPal call.
3. **Reset racing a payment:** Reset demo runs while a demo milestone is being funded or captured. Reset takes the demo lock and the same row locks; a project whose payment becomes live mid-reset is kept, never half-deleted.
4. **A FAIL slipping through on another path:** approval from DISPUTED, a resubmission that produced a FAIL after an earlier PASS, or an override of only spaces. Each goes through the same guard with the latest completed run.
5. **A demo-repo option on a real project:** a non-demo project shows no demo options, and the server doesn't treat a demo URL any differently (it's validated like any other submission).

---

## Implementation Plan

### Task 1: Merge both branches and cap test workers

**Files:**
- New branch `phase-6-integration` from local `main` (`fadf581` plus this plan's commit), in a new worktree `../arbiter-p6`, with `.env.local` copied (not printed) and checked as git-ignored.
- Merge `origin/phase-4-verification` (`f6e6642`), then `origin/phase-5-payments` (`1b500d6`).
- `spikes/FINDINGS.md` is the only file both branches changed (different sections), so a conflict there is resolved by keeping both sections.
- `CLAUDE.md`: Phase 4's change to rule 4 (the browser job fetches the runner repo anonymously) comes in with the merge. Point it out to the user in the Task 1 report, since it's a project rule.
- Modify `web/vitest.config.ts` (`test.maxWorkers: 2`; Vitest is 5.1.0, so check the option name in its docs, since `minWorkers` was removed in v4), `web/package.json` (`"test": "vitest run --maxWorkers=2"`) and `.github/workflows/ci.yml` (the second job's `npx vitest run` becomes `npm test`, so both CI jobs use the cap).

- [ ] Merge, resolve, commit the merge.
- [ ] Run each of these through PowerShell, one at a time, and read the output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Expected: every test passes (Phase 4's plus Phase 5's), 0 type errors, 0 lint errors, and the build succeeds. Record the counts.
- [ ] Commit `chore: cap vitest at 2 workers in the script, config and CI`.

### Task 2: The guard reads Phase 4's verdicts

**Files:** `web/src/server/payments/verdicts.ts` (rewritten as an adapter) with its test; `payment-actions.ts` and `milestone-payment.tsx` (switch the import).

**Interfaces:**
- Consumes `latestVerdicts(db, milestoneId)` from `server/verification/report.ts`: `{ runId, verdicts: { criterionId, verdict }[], hasFail } | null`.
- Produces `guardVerdicts(db): LatestVerdicts`, the `(milestoneId) => Promise<Verdict[] | null>` type from `guard.ts`. It maps Phase 4's verdict strings to `"pass" | "fail" | "needs_review"`; an unknown string throws, so the guard fails closed. `latestRunVerdicts` is deleted, leaving one read path.

- [ ] Tests (PGlite, real Phase 4 rows built with Phase 4's `test-fixtures.ts`):
  - no submission → null → the guard refuses with its "no report" error;
  - a run that is still going, or errored → null;
  - a completed run with one FAIL → the guard refuses with `fail_without_override`;
  - the same with an override of 20 or more characters → allowed, and `override_recorded` is audited;
  - an override of 25 spaces → `override_too_short`;
  - a resubmission whose new run FAILs after an older PASS → refused (the latest run wins);
  - an unknown verdict string → the guard refuses, it doesn't allow.
- [ ] Implement, run the payments and verification tests, commit `feat: payment guard reads Phase 4 latestVerdicts`.

### Task 3: Approve on the report page; Disagree → DISPUTED → approve or cancel

**Files:**
- `web/src/app/(app)/projects/[projectId]/milestones/[milestoneId]/report/page.tsx`: render `ReleasePanel` for the client at REPORT_READY and DISPUTED, under the criteria.
- `web/src/components/payments/release-panel.tsx`: the Approve button and the override field stay here; add a `showApprove` prop, false everywhere except the report page.
- New `web/src/components/verification/disagree-form.tsx`.
- New `web/src/server/verification/disputes.ts` (with test): `disagree(db, { userId, milestoneId, comment })`.
- `verification-actions.ts`: add `disagreeAction`.
- `web/src/server/payments/funding.ts`: `cancelFunding` also accepts DISPUTED.
- `payment-actions.ts`: unchanged API.
- `web/src/server/audit/audit.ts`: add `dispute_opened`.
- `web/src/lib/messages-verification.ts`.

**Interfaces:** `disagree` is for either party, REPORT_READY only. The comment is 10–2000 characters with no control characters (`hasControlChars`, multi-line). In one transaction it inserts a `disputes` row, transitions `disagree`, and audits `dispute_opened` with the comment's length, not its text.

- [ ] Tests:
  - the freelancer or client disagrees at REPORT_READY → DISPUTED, with one `disputes` row;
  - disagreeing in any other state is refused;
  - a non-member gets `not_found`;
  - DISPUTED → approve runs the same guard (a FAIL with no override is refused);
  - DISPUTED → cancel voids the authorization with PayPal (the fake) and moves to CANCELLED;
  - the milestone panel no longer shows Approve, and the report page shows it to the client only.
- [ ] Implement, commit `feat: approve on the report page; disagree opens a dispute`.

### Task 4: Money moves only on POST

**Files:**
- `web/src/app/api/payments/[paymentId]/route.ts`: GET returns the stored payment view only (no PayPal call). New POST runs `reconcilePayment`: members only, same-origin, at most once every 30 s (already in `reconcilePayment`).
- `web/src/app/api/verification-runs/[runId]/route.ts`: GET returns status only. New POST calls `resumeDueRuns`. A dispatch isn't money, but GET stays free of side effects everywhere.
- New `web/src/server/http/same-origin.ts` (with test): `isSameOrigin(request: Request, allowedOrigin: string): boolean`. `allowedOrigin` is `new URL(AUTH_URL).origin` in production, or the request's own origin in development. On Render the Host header is `localhost:10000` (FINDINGS, Phase 2), so Host must not be used.
- The server actions in `payment-actions.ts` and `verification-actions.ts` call the same check through `headers()`. Next already checks the Origin of server actions; this makes the rule explicit and tested.
- `release-panel.tsx` and `verification-panel.tsx`: the poll is GET; when the stored state says something is still moving (capture pending, payout pending, run in progress), the client POSTs a reconcile at most every 30 s.
- New `web/src/server/payments/payment-view.ts` (with test): `getPaymentView(db, { userId, paymentId })`, read-only and members only. It's split out of `reconcile.ts`.

- [ ] Tests:
  - GET on a payment whose capture just completed makes no PayPal call (a fake that throws if called) and doesn't change the row;
  - POST with a matching Origin reconciles;
  - POST with a missing or foreign Origin → 403 before any DB or PayPal call;
  - POST by a non-member → 404;
  - the verification GET leaves due runs untouched, and its POST advances them;
  - `isSameOrigin` handles a trailing slash, another port, `null` and a scheme mismatch.
- [ ] Grep proof, saved in the Task 4 commit message: `reconcilePayment`, `sendPayout`, `captureApproved` and `resumeDueRuns` are called only from POST handlers, server actions, the webhook route, `instrumentation-node.ts` boot resume, and `server/payments/*` and `server/verification/*` internals.
- [ ] Implement, commit `fix: GET polls are read-only; reconcile only on same-origin POST`.

### Task 5: Remove every test-only path

**Files:** delete `web/scripts/dev-fund-milestone.ts` and `web/scripts/dev-report-ready.ts` (and any tests or `package.json` scripts that point at them). New `web/src/server/milestones/transition-callers.test.ts`.

- [ ] Write the architecture test first and watch it fail while the scripts exist. It reads every `.ts` and `.tsx` file under `web/src` and `web/scripts` (not tests) and asserts:
  - the `"authorized"` event is passed to `transitionMilestone` only in `server/payments/funding.ts`, after a PayPal authorize call;
  - `"report_ready"` only in `server/verification/runs.ts`, after the verdicts of a real run are written;
  - `server/milestones/state-machine.ts` may name both events, because it defines the transition table; it doesn't call a transition;
  - no file under `web/scripts` imports `transitionMilestone` or writes `milestones.state`.
- [ ] Delete the scripts, then run the test (passes) and the full suite.
- [ ] Grep proof, saved in the commit message: `git grep -nE "dev-fund-milestone|dev-report-ready|\"authorized\"|\"report_ready\""` lists only the two allowed call sites, tests and docs.
- [ ] Commit `chore: remove test-only paths to FUNDED and REPORT_READY`.

### Task 6: Reset demo keeps projects with a live PayPal payment

**Files:** `web/src/server/demo/seed.ts` and `seed.test.ts`; `web/src/app/(app)/dashboard/page.tsx` (a "Kept: live PayPal payment" note on kept projects); `web/src/app/(app)/dashboard/reset-demo-button.tsx` (its confirm text says what is kept).

**Rule:** a demo project is **kept** when any of its milestones has a payment row (superseded or not) whose `status` is not `order_pending`, `voided` or `authorization_lost`. So `authorized`, `approved`, `capture_pending`, `captured`, `capture_denied`, `payout_pending`, `payout_failed`, `payout_unknown` and `paid` are all kept.
- This is wider than the user's list on purpose: `payout_failed` means money was captured but the freelancer wasn't paid, and `paid` is a completed real money flow. Deleting either would lose the record of real sandbox money.
- Kept projects keep every row: milestones, runs, evidence, disputes and the audit chain.
- Reset deletes every other demo project and re-creates both seed projects. A kept TaskBoard therefore appears next to a fresh TaskBoard, and the kept one carries the note.

**Fix found while planning:** `deleteDemoProjects` deletes evidence only by `check_result_id`, but Phase 4 stores run-level evidence with `run_id` and a null `check_result_id`. So a reset of a demo with a verification run would fail on the foreign key. Delete evidence by run too.

- [ ] Tests (PGlite):
  - a demo project with a `capture_pending` payment (TaskBoard-like: capture ID `24140907B72033302`, milestone CAPTURE_PENDING) survives reset with every row and an intact hash chain (`verifyChain` in `server/audit/audit.ts`);
  - one test per kept status above;
  - a project whose only payment is `voided` or `order_pending` is deleted;
  - a demo project with a verification run and run-level evidence is deleted cleanly (fails before the fix);
  - after a reset there are two fresh seed projects plus the kept ones;
  - the 30-second cooldown still holds;
  - non-demo projects are never touched.
- [ ] Implement, commit `fix(demo): reset keeps projects with a live PayPal payment`.

### Task 7: One-click demo repos on the submit form

**Files:** new `web/src/lib/demo-repos.ts`; `web/src/components/verification/verification-panel.tsx`; the project page passes `isDemo` to the panel (the project row already has `is_demo`).

**Data:** three entries `{ id: "pass" | "fail" | "injection", label, repoUrl, commitSha, deployUrl, expect }`:
- **repo URLs:** `https://github.com/antonyjasfer/arbiter-demo-{pass,fail,injection}`;
- **commits:** the full 40-character SHAs of the pinned commits `06a22b8`, `134409c` and `c8c1a71` (FINDINGS, Phase 4 live checks), resolved with `git ls-remote` at implementation time;
- **deploy URLs:** the three Render services' URLs, read with the Render tools;
- **expect:** one line each, such as "Ticking a task fails on the deployed site, though its own tests pass".

- [ ] Tests (`demo-repos.test.ts`): each SHA is 40 hex, each repo URL passes `submitWork`'s validator, and each deploy URL is https and not private. The panel shows the options only when `isDemo` is true. Choosing one fills the three fields, and the user still presses "Submit and verify" (no auto-submit).
- [ ] Before committing, check each deploy URL answers `/health` (warming each service is fine) and each SHA exists on GitHub (a status-only call).
- [ ] Commit `feat: one-click demo repos on the demo submit form`.

### Task 8: "What Arbiter checked" on the report

**Files:** `web/src/components/verification/report-view.tsx`, `web/src/server/verification/report.ts` (the criterion already carries its planned `steps`), and `web/src/lib/describe-step.ts` (reused, not changed).

- [ ] For each criterion, before the verdict details, show "What Arbiter checked" as a numbered list of `describeStep(step)` for every planned step, with the kind's label. A `test` kind says "Ran the freelancer's own test suite (`npm test`)". A `review` kind says "No automatic check; a person decides".
- [ ] Tests (`report.test.ts`): every criterion in the read model has its planned steps in order, and a review criterion has none. Then a browser check of the report page for the pass demo.
- [ ] Commit `feat(report): show what Arbiter checked for each criterion`.

### Task 9: Copy fixes and the dashboard prerender warning

**Files:** `web/src/components/agreement/agreement-workspace.tsx` and any other file the copy sweep finds; `web/src/app/(app)/dashboard/page.tsx` (or the component the build log names).

- [ ] **Copy:** the "Its milestones are now AGREED; funding them with PayPal comes next" note depends on the milestones' states. If all are still AGREED it says that; otherwise it says "Milestones are funded and tracked below". Sweep `web/src` for other copy that predates Phases 4 and 5 (for example "comes next", "Phase", "not built yet") and fix each case. Test: the workspace renders the right sentence for an AGREED milestone and for a FUNDED one.
- [ ] **Warning:** reproduce the `crypto.getRandomValues` warning with `npm run build` (PowerShell) and find the component that calls it during prerender. Fix it the same way as the header in Phase 3: `await connection()`, or move the call inside the request-time Suspense boundary. Expected: the build log has no such warning, and the dashboard still works signed in and signed out.
- [ ] Commit `fix: post-funding copy and dashboard prerender warning`.

### Task 10: Fresh-subagent security review

- [ ] Dispatch a fresh reviewer (superpowers:requesting-code-review, most capable model) on `main...phase-6-integration`. Give it this plan's Review Focus 1–5, CLAUDE.md rules 1–5, and the Phase 4 and 5 Review Focus lists.
- [ ] Fix Critical and Important findings test-first (each RED → GREEN, then the full suite). List the Minors for the user.
- [ ] Re-run test, typecheck, lint and build (PowerShell, one at a time). Commit.

### Task 11: Deploy

- [ ] **Secret scan** of everything being pushed: gitleaks if available, otherwise grep for `github_pat_`, `AIza`, `-----BEGIN`, `EC`/`EH`-prefixed PayPal secrets, and each `.env.local` value (compared in a script, never printed). Confirm `.env.local` isn't tracked. Show the result.
- [ ] Merge `phase-6-integration` into `main` with a merge commit. Push `main`, ending with a commit that touches `web/`. Watch CI and the Render deploy, and check `/api/health?db=1` → 200.
- [ ] **Render env vars, by name only:** list the names on the service and compare them with `serverEnv`'s schema plus `AUTH_URL` and `DEMO_MODE`. Tell the user which are missing.
- [ ] **DEMO_MODE:** only after the deploy carrying Task 6 is live and its live check passes (sign in as the demo client and see the kept-project note), tell the user it's safe to set `DEMO_MODE=true` and redeploy. If it's already `true`, say so.

### Task 12: Live end to end, recorded in FINDINGS

Run on https://arbiter-q41f.onrender.com, one browser at a time. The user approves the PayPal popup as the client's sandbox buyer; Claude never types the buyer's credentials.

- [ ] **Pass flow:**
  1. As the demo client, fund an AGREED milestone of a fresh seed project, not TaskBoard milestone 1 (the user approves in PayPal).
  2. As the demo freelancer, submit demo-pass with one click.
  3. Verification runs (the cold start is tolerated) and the report shows "What Arbiter checked".
  4. The client approves on the report page → capture. COMPLETED → RELEASED → payout → PAID, or PENDING → CAPTURE_PENDING with the honest copy.
- [ ] **Fail flow:** on a second funded milestone, submit demo-fail. The report shows the tick FAIL. Approve without an override is refused with the clear message. Then stop: don't override, so no second capture. Optionally Disagree → DISPUTED → Cancel, which voids the hold.
- [ ] **Record in FINDINGS "Phase 6 live checks":** the order, authorization, capture and payout IDs, the run URLs, timings, which state changes came from webhooks and which from POST reconcile, and the refused-approval message. Commit and push (ending with a `web/` change, or a manual deploy if the push is docs-only).
- [ ] Report to the user: files changed, features completed, tests run with real results, known limitations, and manual steps. Then stop.

## Open questions for the user

1. **TaskBoard milestone 1 and the new POST reconcile:** after Task 4, opening that project's page on the live site POSTs a reconcile. If PayPal has since completed capture `24140907B72033302`, Arbiter would move it to RELEASED and send the $189.00 payout, which is the designed behaviour. Should that be allowed once Phase 6 is live, or should milestone 1 stay untouched (no page visit) until you say so? Default: untouched.
2. **The vitest cap "now":** I read "add it to the shared config now" as part of Task 1 (`vitest.config.ts` is the shared config), since this step changes no code. Say if you want it committed to `main` before Phase 6 starts.
