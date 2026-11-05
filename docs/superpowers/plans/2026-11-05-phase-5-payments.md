# Phase 5 PayPal Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client funds one milestone with a PayPal sandbox authorization (FUNDED). After the client approves, server code captures the payment and pays the freelancer the milestone minus the fee. Every step is guarded, idempotent, reconciled with PayPal and audited, and the AI can never move money.

**Architecture:**
- **Branch:** `phase-5-payments`, in its own git worktree cut from `main` after the Part A prep. Migration 0003 is already applied, and Phase 5 adds **no migrations**.
- **Where PayPal is called:** only in `web/src/server/payments/`, deterministic code that money-moving calls are confined to (CLAUDE.md rule 1).
- **Payment rows:** the `payments` row holds PayPal's IDs and statuses, and every update is guarded by `state_version`.
- **Milestone state:** moves through the existing transition table: AGREED→FUNDED (`authorized`), REPORT_READY/DISPUTED→APPROVED (`approve`), APPROVED→CAPTURE_PENDING or RELEASED, CAPTURE_PENDING→RELEASED or APPROVED (`capture_denied`), RELEASED→PAID (`payout_succeeded`), FUNDED→AGREED (`authorization_lost`), FUNDED→CANCELLED (`cancel`).
- **Reconciling:** payment state is read back from PayPal when a webhook arrives, when the page is viewed, and on polls. Webhooks alone are never trusted.

**Tech Stack:**
- PayPal REST: Orders v2, Payments v2, Payouts v1 and Webhooks v1, through a `fetch` client extended from `server/paypal/client.ts`. It is sandbox-only, sends a stored `PayPal-Request-Id` on every write, and validates every response with Zod.
- PayPal JS SDK v6 buttons on the client. The exact script URL and API are checked against PayPal's v6 docs (or the PayPal MCP) at Task 1, before any code is written.

**Spec:** `docs/arbiter-plan.md` (Phase 5 in section 9, the Rev 2 lost-authorization note), `CLAUDE.md` (rules 1–3, 6 and 8), `spikes/FINDINGS.md` section 1 (PayPal spike: the 29-day authorization, the 3-day honor period, PENDING_REVIEW captures, the reauthorize 422), and the user's Phase 5 message of 5 Nov 2026.

## Global Constraints

- **Sandbox only.** No AI code path calls a money-moving endpoint. Only `server/payments/*` calls create order, authorize, capture, void, reauthorize and payouts.
- **The payment guard runs before every capture and every payout:**
  - the amount is at most the milestone amount;
  - the payee is the agreed freelancer's `paypal_email`;
  - the approver is the project's client;
  - the latest run has no FAIL, or a written client override (`override_reason`) is recorded;
  - before a payout, the capture is COMPLETED, as read back from PayPal.
- **Idempotency:** every PayPal write sends a `PayPal-Request-Id` that is stored in `payments.request_ids` before the call and reused on retry. Every payment update is `WHERE id = … AND state_version = n`, and every milestone move is a guarded transition, both in the same transaction as their audit event.
- **Fee:** the payout is `amount − feeFor(amount)`, which is 5% + $1.00 using the existing `feeFor`, stored as `fee` and `payout_amount`.
- **Webhooks:** order-independent and idempotent. A webhook only triggers a reconcile; the state comes from PayPal's read-back. Subscriptions add PAYMENT.CAPTURE.DENIED, REVERSED and REFUNDED via `register-webhook.ts`.
- **Lost authorization:** an expired or voided authorization in FUNDED moves to AGREED via `authorization_lost`. In SUBMITTED, VERIFYING, REPORT_READY or DISPUTED, the milestone keeps its state; the payment is marked `authorization_lost` and the UI shows "Re-fund needed". Approval is blocked until a new authorization supersedes the lost one.
- **Reauthorize:** a 422 inside the honor period means "not needed", not an error.
- **No paid cron:** reconciling happens on webhook, page view and poll.
- **Local end-to-end (user, 5 Nov):** `main` doesn't have Phase 5 yet, so the Task 8 payment runs **locally** (`next dev` on port 3001) against the PayPal sandbox. PayPal can't deliver webhooks to localhost, so reconcile-on-poll does all the state moves there. That run also proves the lost-webhook path.
- **The test-only path to REPORT_READY** is a local CLI script, `web/scripts/dev-report-ready.ts`, that uses the DB directly through guarded `transitionMilestone` calls (SUBMITTED→VERIFYING→REPORT_READY with a fixture submission). It is **never** an HTTP route or server action, it refuses to run unless `PAYPAL_ENVIRONMENT=SANDBOX` and it gets an explicit milestone ID, and it audits what it did. Phase 6 deletes it.
- **Honest copy:** a pending capture says "PayPal is settling this payment; Arbiter pays the freelancer once it completes."
- **No file outside the owned list is edited** without telling the user. No migrations.

## Files

**Owned by Phase 5 (create or modify only these):**
- **Server:** `web/src/server/payments/`, each file with a `*.test.ts`:
  - `paypal-api.ts`: typed, Zod-validated wrappers for orders, authorizations, captures, payouts and reauthorize, sandbox host only, using the client below.
  - `request-ids.ts`: allocates and stores a `PayPal-Request-Id` per payment action.
  - `guard.ts`: the payment guard, pure apart from its reads.
  - `funding.ts`: create order, record approval, authorize → FUNDED, void → CANCELLED.
  - `release.ts`: approve → capture → CAPTURE_PENDING or RELEASED → payout → PAID.
  - `reconcile.ts`: read back the order, authorization, capture and payout, then apply state through guarded transitions.
  - `lost-authorization.ts`: the "re-fund needed" path, reauthorize, and the honor-period handling.
  - `timeline.ts`: the payment timeline read model.
- **Modified:** `web/src/server/paypal/client.ts` (adds the authenticated POST helper with a request ID, sandbox host only) and `web/src/server/paypal/reconcile.ts` with `webhook-handler.ts` (hand the reconciled resource to `payments/reconcile.ts`).
- **App:** `web/src/app/(app)/projects/payment-actions.ts`; `web/src/app/api/payments/[paymentId]/route.ts` (reconcile on poll); `web/src/app/(app)/settings/page.tsx` (the freelancer's sandbox PayPal email).
- **UI:** `web/src/components/payments/*`, including filling in `milestone-payment.tsx` (the v6 buttons, the timeline and the fee breakdown), and `web/src/lib/messages-payments.ts`.
- **Spikes:** `spikes/03-webhook/register-webhook.ts` and its test (adding the DENIED, REVERSED and REFUNDED subscriptions).
- **Test-only script:** `web/scripts/dev-report-ready.ts` (deleted in Phase 6).
- **Docs:** `README.md`'s "Payments" section only, which is new; Phase 4 doesn't touch the README. `spikes/FINDINGS.md` only in the "Phase 5 live checks" section.

**Shared with Phase 4:** none. Phase 4 doesn't touch `server/paypal/*`.

## Review Focus

1. **Replays:** the same capture or payout action is clicked twice, or retried after a timeout. The same `PayPal-Request-Id` is sent, PayPal returns the original result, and the DB records one capture and one payout (Task 4).
2. **Guard bypass attempts:**
   - an approval by the freelancer;
   - a payee email changed after funding;
   - an amount above the milestone;
   - a FAIL in the latest run with no override;
   - a payout attempted while the capture is PENDING.

   Each is refused before any PayPal call (Task 3).
3. **Out-of-order or forged webhooks:** CAPTURE.COMPLETED arriving before the approval is recorded, a duplicate PAYOUTS-ITEM.SUCCEEDED, a forged event. State only moves after a read-back, transitions are guarded, and duplicates do nothing (Task 6).
4. **Lost authorization in each pre-capture state:** each state goes to the right place, approval is blocked, and re-funding supersedes the old payment row (Task 5).
5. **Lost webhooks during a deploy:** opening the project page reconciles a capture that completed while the service was down, and the payout follows (Task 6).

---

### Task 1: PayPal JS SDK v6 buttons and funding

**Files:** `funding.ts`, `paypal-api.ts`, `request-ids.ts`, `payment-actions.ts`, `components/payments/fund-button.tsx`.

- [ ] Read PayPal's v6 web SDK docs for the sandbox script URL, the client-token/session flow and the button API. Note the source in a code comment.
- [ ] Tests (fake PayPal):
  - The client-only `startFunding` creates an `intent: AUTHORIZE` order for exactly the milestone amount, in USD, with a stored request ID.
  - It refuses a milestone that isn't AGREED, or that already has a live payment.
  - `completeFunding` authorizes the approved order, stores `authorization_id`, `authorization_expires_at` and an `honor_period_ends_at` of authorization time + 3 days, and moves AGREED→FUNDED via `authorized`, auditing `funded`.
  - A replayed authorize, with the same request ID, records one row.
  - The buyer cancelling leaves AGREED.
- [ ] Implement the server side, then the v6 button component in the Part A slot. Commit.

### Task 2: Settings page and the payee email

**Files:** `settings/page.tsx`, `payment-actions.ts`, `messages-payments.ts`.

- [ ] Tests: a user sets a valid email; demo users can't change the seeded email; the email is audited as `paypal_email_set` with no value in the audit data; a payment snapshots `payee_email` when it's created.
- [ ] Implement, commit.

### Task 3: The payment guard

**Files:** `guard.ts` (with test).

**Interfaces:** `checkRelease(db, { userId, milestoneId, overrideReason? }): Result<ReleasePlan, GuardError>`. It takes the latest-verdicts read as an injected function, so Phase 6 can plug in Phase 4's `latestVerdicts`. Until then, the Phase 5 tests pass a fake.

- [ ] Tests, one per rule from Review Focus 2, plus: an override requires at least 20 characters of text and is audited as `override_recorded`.
- [ ] Implement, commit.

### Task 4: Release: approve, capture, payout

**Files:** `release.ts` (with test).

- [ ] Tests:
  - REPORT_READY → approve: the guard runs, then a capture with a request ID. COMPLETED goes to RELEASED; PENDING goes to CAPTURE_PENDING with the honest copy; DECLINED goes back to APPROVED via `capture_denied`.
  - RELEASED: the payout of `payout_amount` to `payee_email` with a request ID; the batch and item IDs are stored.
  - PAYOUTS-ITEM SUCCESS → PAID.
  - Replays of each step are no-ops.
  - A payout never starts unless the read-back capture is COMPLETED.
- [ ] Implement, commit.

### Task 5: Cancel, void, lost authorization, reauthorize

**Files:** `funding.ts` and `lost-authorization.ts` (with tests).

- [ ] Tests:
  - FUNDED → cancel voids the authorization and moves to CANCELLED.
  - A read-back of `VOIDED` or `EXPIRED`: in FUNDED, moves to AGREED via `authorization_lost`; in SUBMITTED, VERIFYING, REPORT_READY or DISPUTED, the milestone state is kept, the payment is marked `authorization_lost`, and approval is refused with `refund_needed`.
  - Re-funding creates a new payment row and supersedes the old one.
  - Reauthorize inside the honor period: a 422 records "not needed".
- [ ] Implement, commit.

### Task 6: Webhooks move state; reconcile on view and poll

**Files:** `payments/reconcile.ts` (with test), `server/paypal/reconcile.ts` and `webhook-handler.ts` (modified), `app/api/payments/[paymentId]/route.ts`, and `register-webhook.ts` (with its test).

- [ ] Tests:
  - Each subscribed event type triggers a read-back and then the matching guarded transition.
  - Arrival order doesn't matter.
  - Duplicates do nothing.
  - A forged event is still rejected by verification (the existing tests stay green).
  - A page view or poll reconciles a stale payment (`last_reconciled_at` older than 30 s).
  - CAPTURE.DENIED, REVERSED and REFUNDED are handled: denied goes back to APPROVED; reversed or refunded after payout is flagged for a human, with no automatic clawback.
  - `register-webhook.ts` adds the three event types (its test is updated).
- [ ] Implement, re-register the webhook (a PATCH; the ID is unchanged), commit.

### Task 7: Payment timeline UI

**Files:** `timeline.ts` (with test) and `components/payments/*`.

- [ ] The timeline shows each step's status from PayPal, with the fee breakdown: milestone $X; Arbiter fee $Y (5% + $1.00); freelancer receives $Z. It also covers the pending-capture copy, "re-fund needed" with a re-fund button, and the honor-period note. Lint, typecheck, build, and a browser walkthrough with the sandbox.
- [ ] Commit.

### Task 8: End-to-end sandbox payment by 7 Nov, review, handoff

- [ ] **By end of 7 Nov IST:** one real sandbox flow, run **locally** on port 3001 against the sandbox (`main` has no Phase 5 yet):
  1. fund (the user approves in the PayPal popup as the sandbox buyer; Claude never types the buyer's credentials);
  2. `dev-report-ready.ts` moves the milestone to REPORT_READY;
  3. the client approves → capture → payout to `PAYPAL_FREELANCER_EMAIL`.

  No webhooks reach localhost, so every state move after funding comes from reconcile-on-poll, which also proves the lost-webhook path (Review Focus 5). The capture may sit PENDING for days (FINDINGS), which is why this runs early. Record the IDs, timings and "moved by poll, no webhook" in FINDINGS "Phase 5 live checks". The real flow on the live site follows in Phase 6.
- [ ] **Review:** a fresh-subagent security review of `server/payments/*`, using the Review Focus list; fix Important and above test-first.
- [ ] **README "Payments" section:** the honest limits (29-day authorization, 3-day honor period, PENDING captures, not an escrow service, platform approval needed in production).
- [ ] **Last, after everything else:** add the judge sandbox buyer login (a dedicated US sandbox personal account the user created; a test credential) to the README "Payments" section. The user provides the email and password at that point; ask for them then, and don't write placeholders that look real before that.
- [ ] **Handoff:** don't merge to `main` alone. Hand to Phase 6. Run the secret scan before every push.

## Render and PayPal settings the user adds

- On Render `arbiter`: `PAYPAL_FREELANCER_EMAIL` (the sandbox personal account that receives payouts). `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` are already set.
- `PAYPAL_FREELANCER_EMAIL` is set on Render (user, 5 Nov).
- **Judge account:** created by the user (a US sandbox personal account). Its login goes in the README at the end of Task 8.

## What Phase 6 must connect

- **Guard input:** `checkRelease`'s latest-verdicts input is replaced with Phase 4's `latestVerdicts(milestoneId)`.
- **Approval trigger:** the approve button appears on Phase 4's report page (REPORT_READY); the Disagree flow leads to DISPUTED and then to approve or cancel.
- **Removing the test-only paths:** delete `web/scripts/dev-report-ready.ts` (Phase 5) and `web/scripts/dev-fund-milestone.ts` (Phase 4), and the full flow runs on the demo: fund → submit → verify → approve → capture → payout.
