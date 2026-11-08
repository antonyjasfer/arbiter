// Release: the client's approval -> capture -> (CAPTURE_PENDING ->) RELEASED -> payout -> PAID.
// Deterministic server code only; no AI path reaches here (CLAUDE.md rule 1). The guard runs before the
// capture (checkRelease) and before the payout (checkPayout). Every PayPal write sends a request id stored
// before the call; no DB transaction is held across a PayPal call. Every state change is applied from what
// PayPal returned or reports on a read-back, through guarded updates, so replays and concurrent polls are
// no-ops. Sources: Payments v2 (capture authorization, show capture; capture statuses COMPLETED, DECLINED,
// PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED) and Payouts v1 (create batch payout: the 201 holds only
// batch_header; sender_batch_id is unique for 30 days; item statuses SUCCESS, FAILED, PENDING, UNCLAIMED,
// RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED): developer.paypal.com/api/payments/v2,
// developer.paypal.com/api/payments.payouts-batch/v1.
import { and, eq, isNull, sql } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { appendAudit, type AuditAction } from "../audit/audit";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import type { MilestoneEvent, MilestoneState } from "../milestones/state-machine";
import { moneyToCents } from "../projects/money";
import { livePayment, loadMilestone, type PaymentRow } from "./context";
import { checkPayout, checkRelease, recordOverride, type GuardError, type LatestVerdicts, type PayoutGuardError, type ReleasePlan } from "./guard";
import { PaypalApiError, type PaypalApi, type PaypalCapture } from "./paypal-api";
import { ensureRequestId } from "./request-ids";

type PaypalFailure = "paypal_refused" | "paypal_unavailable";
export type ReleaseError = GuardError | PaypalFailure | "amount_mismatch" | "conflict";
export type PayoutError = PayoutGuardError | PaypalFailure | "payout_failed" | "payout_unknown" | "conflict";
type StateResult<E> = Result<{ state: MilestoneState }, E>;

// Item statuses that end a payout without paying, plus batch statuses (DENIED, CANCELED) for a batch read
// back with no items.
const FAILED_PAYOUT = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"]);
/** Payout row statuses that polling never retries: a human decides. */
export const PAYOUT_STOPPED = new Set(["payout_failed", "payout_unknown"]);
/**
 * A capture the merchant refunded or PayPal reversed (Payments v2 capture statuses, plus REVERSED in case a
 * reversal is reported on the capture itself). Flagged for a human: Arbiter never claws a payout back.
 */
export const CAPTURE_REFUNDED = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]);
const LOST_RACE = "lost_race";

function paypalFailure(e: unknown): PaypalFailure {
  return e instanceof PaypalApiError && e.status < 500 ? "paypal_refused" : "paypal_unavailable";
}

/**
 * How a create-payout error is handled. Temporary (retry later): network errors, 5xx, 429, 409 and
 * INSUFFICIENT_FUNDS (a fresh capture may not be spendable yet in sandbox). Unknown (PayPal may already
 * have paid; a human checks the dashboard): any duplicate answer, or a bare USER_BUSINESS_ERROR, which is
 * also how a reused sender_batch_id comes back. Anything else is a permanent refusal.
 */
function payoutFailure(e: unknown): "temporary" | "unknown" | "refused" {
  if (!(e instanceof PaypalApiError) || e.status >= 500 || e.status === 429 || e.status === 409 || e.issue === "INSUFFICIENT_FUNDS") return "temporary";
  if (/DUPLICATE/.test(e.issue) || e.issue === "USER_BUSINESS_ERROR") return "unknown";
  return "refused";
}

async function paymentById(db: Db, paymentId: string): Promise<PaymentRow | null> {
  if (!parseId(paymentId)) return null;
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  return p ?? null;
}

const bump = () => ({ updatedAt: new Date(), lastReconciledAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` });

/** Run `apply` until it does not lose a race on state_version (at most 3 tries). */
async function retryOnRace<T>(apply: () => Promise<T | typeof LOST_RACE>): Promise<T | "conflict"> {
  for (let i = 0; i < 3; i++) {
    const r = await apply().catch((e: unknown): typeof LOST_RACE => {
      if (e instanceof Error && e.message === LOST_RACE) return LOST_RACE;
      throw e;
    });
    if (r !== LOST_RACE) return r;
  }
  return "conflict";
}

/** The client approves the release: guard, record the approval, then capture. */
export async function approveRelease(
  db: Db,
  api: PaypalApi,
  args: { userId: string; milestoneId: string; overrideReason?: string; latestVerdicts: LatestVerdicts },
): Promise<StateResult<ReleaseError>> {
  if (!parseId(args.milestoneId)) return { ok: false, error: "not_found" };
  // A retry from APPROVED (after a capture timeout) reuses the reason recorded with the approval.
  const stored = await livePayment(db, args.milestoneId);
  const overrideReason = args.overrideReason ?? (stored?.approvedBy ? (stored.overrideReason ?? undefined) : undefined);
  const plan = await checkRelease(db, { ...args, overrideReason });
  if (!plan.ok) return plan;
  if (plan.value.milestone.state !== "APPROVED") {
    // Losing this race means a concurrent click recorded the approval: carry on to the (replayed) capture.
    await recordApproval(db, args.userId, plan.value);
  }
  return captureApproved(db, api, plan.value.payment.id);
}

async function recordApproval(db: Db, userId: string, plan: ReleasePlan): Promise<"recorded" | typeof LOST_RACE> {
  const { milestone: m, payment: p } = plan;
  return db
    .transaction(async (tx) => {
      const rows = await tx
        .update(payments)
        .set({ approvedBy: userId, approvedAt: new Date(), overrideReason: plan.overrideReason, status: "approved", ...bump() })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion), isNull(payments.approvedBy)))
        .returning({ id: payments.id });
      if (rows.length === 0) throw new Error(LOST_RACE);
      const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: m.state, expectedVersion: m.stateVersion, event: "approve" });
      if (!moved.ok) throw new Error(LOST_RACE);
      await appendAudit(tx, {
        projectId: m.projectId,
        actorId: userId,
        action: "release_approved",
        data: { milestoneId: m.id, paymentId: p.id, amount: p.amount, fee: p.fee, payoutAmount: p.payoutAmount, override: plan.hasFail },
      });
      if (plan.overrideReason) await recordOverride(tx, { projectId: m.projectId, userId, milestoneId: m.id, paymentId: p.id, reason: plan.overrideReason });
      return "recorded" as const;
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message === LOST_RACE) return LOST_RACE;
      throw e;
    });
}

/** Capture an approved payment (or replay the capture with its stored request id). */
async function captureApproved(db: Db, api: PaypalApi, paymentId: string): Promise<StateResult<ReleaseError>> {
  const p = await paymentById(db, paymentId);
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  if (m.state !== "APPROVED") return { ok: true, value: { state: m.state } };
  if (!p.approvedBy || !p.authorizationId) return { ok: false, error: "not_releasable" };
  // Known gap (Task 5/6): after a DECLINED capture the authorization is spent; re-funding is the way on.
  if (p.captureId) return p.captureStatus === "DECLINED" || p.captureStatus === "FAILED" ? { ok: true, value: { state: m.state } } : reconcileCapture(db, api, p.id);

  const requestId = await ensureRequestId(db, p.id, "capture");
  let cap: PaypalCapture;
  try {
    cap = await api.captureAuthorization(p.authorizationId, { amountCents: moneyToCents(p.amount), invoiceId: p.id, requestId });
  } catch (e) {
    return { ok: false, error: paypalFailure(e) };
  }
  return applyCapture(db, p.id, cap);
}

function captureEvent(state: MilestoneState, status: string): MilestoneEvent | null {
  if (status === "COMPLETED" && (state === "APPROVED" || state === "CAPTURE_PENDING")) return "capture_completed";
  if (status === "PENDING" && state === "APPROVED") return "capture_pending";
  if ((status === "DECLINED" || status === "FAILED") && state === "CAPTURE_PENDING") return "capture_denied";
  return null;
}

function captureAudit(status: string): AuditAction | null {
  if (status === "COMPLETED") return "capture_completed";
  if (status === "PENDING") return "capture_pending";
  if (status === "DECLINED" || status === "FAILED") return "capture_denied";
  if (CAPTURE_REFUNDED.has(status)) return "capture_refunded";
  return null;
}

function captureRowStatus(p: PaymentRow, status: string): string {
  if (p.payoutBatchId) return p.status; // past the capture phase: the payout owns the row's status
  if (status === "COMPLETED") return "captured";
  if (status === "PENDING") return "capture_pending";
  if (status === "DECLINED" || status === "FAILED") return "capture_denied";
  if (CAPTURE_REFUNDED.has(status)) return "capture_refunded";
  return p.status;
}

/** Record a capture PayPal returned or reported on a read-back, and move the milestone to match. */
async function applyCapture(db: Db, paymentId: string, cap: PaypalCapture): Promise<StateResult<ReleaseError>> {
  const r = await retryOnRace(async (): Promise<StateResult<ReleaseError> | typeof LOST_RACE> => {
    const p = await paymentById(db, paymentId);
    const m = p && (await loadMilestone(db, p.milestoneId));
    if (!p || !m) return { ok: false, error: "not_found" };
    if (p.captureId && p.captureId !== cap.id) return { ok: false, error: "conflict" };
    // A capture PayPal reports for another amount or currency never releases; a human looks at it.
    if ((cap.amountCents !== null && cap.amountCents !== moneyToCents(p.amount)) || (cap.currency !== null && cap.currency !== "USD")) {
      return { ok: false, error: "amount_mismatch" };
    }
    const changed = p.captureId !== cap.id || p.captureStatus !== cap.status;
    const event = captureEvent(m.state, cap.status);
    if (!changed && !event) {
      await db.update(payments).set({ lastReconciledAt: new Date() }).where(eq(payments.id, p.id));
      return { ok: true, value: { state: m.state } };
    }
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(payments)
        .set({ captureId: cap.id, captureStatus: cap.status, status: captureRowStatus(p, cap.status), ...bump() })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion)))
        .returning({ id: payments.id });
      if (rows.length === 0) throw new Error(LOST_RACE);
      let state = m.state;
      if (event) {
        const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: m.state, expectedVersion: m.stateVersion, event });
        if (!moved.ok) throw new Error(LOST_RACE);
        state = moved.value.state;
      }
      const action = captureAudit(cap.status);
      if (action) {
        await appendAudit(tx, {
          projectId: m.projectId,
          actorId: null,
          action,
          data: {
            milestoneId: m.id,
            paymentId: p.id,
            captureId: cap.id,
            status: cap.status,
            reason: cap.statusReason,
            ...(action === "capture_refunded" ? { needsHuman: true, payoutSent: p.payoutBatchId !== null } : {}),
          },
        });
      }
      return { ok: true, value: { state } };
    });
  });
  return r === "conflict" ? { ok: false, error: "conflict" } : r;
}

/** Read the capture back from PayPal and apply it. */
export async function reconcileCapture(db: Db, api: PaypalApi, paymentId: string): Promise<StateResult<ReleaseError>> {
  const p = await paymentById(db, paymentId);
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  if (!p.captureId) return { ok: true, value: { state: m.state } };
  let cap: PaypalCapture;
  try {
    cap = await api.getCapture(p.captureId);
  } catch (e) {
    return { ok: false, error: paypalFailure(e) };
  }
  return applyCapture(db, p.id, cap);
}

/** RELEASED: pay the freelancer once the capture read back from PayPal is COMPLETED. */
export async function sendPayout(db: Db, api: PaypalApi, paymentId: string): Promise<StateResult<PayoutError>> {
  const p = await paymentById(db, paymentId);
  if (!p) return { ok: false, error: "not_found" };
  if (p.payoutBatchId) return reconcilePayout(db, api, p.id);
  if (p.status === "payout_failed" || p.status === "payout_unknown") return { ok: false, error: p.status };
  if (!p.captureId) return { ok: false, error: "capture_not_completed" };
  let captureStatus: string;
  try {
    captureStatus = (await api.getCapture(p.captureId)).status;
  } catch (e) {
    return { ok: false, error: paypalFailure(e) };
  }
  const plan = await checkPayout(db, { paymentId: p.id, captureStatus });
  if (!plan.ok) return plan;
  const m = plan.value.milestone;

  const requestId = await ensureRequestId(db, p.id, "payout");
  let batch: { batchId: string; batchStatus: string };
  try {
    batch = await api.createPayout({
      // Deterministic per payment: PayPal rejects a reused sender_batch_id for 30 days, a second line of defence.
      senderBatchId: `arbiter-${p.id}`,
      receiver: plan.value.payeeEmail,
      amountCents: plan.value.payoutCents,
      requestId,
      note: "Arbiter milestone payout (PayPal sandbox)",
    });
  } catch (e) {
    const kind = payoutFailure(e);
    if (kind === "temporary") return { ok: false, error: "paypal_unavailable" };
    const issue = (e as PaypalApiError).issue;
    if (kind === "unknown") {
      await markPayoutStopped(db, p.id, "payout_unknown", `UNKNOWN:${issue}`);
      return { ok: false, error: "payout_unknown" };
    }
    await markPayoutStopped(db, p.id, "payout_failed", `REFUSED:${issue}`);
    return { ok: false, error: "paypal_refused" };
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(payments)
      .set({ payoutBatchId: batch.batchId, payoutStatus: batch.batchStatus, status: "payout_pending", ...bump() })
      .where(and(eq(payments.id, p.id), isNull(payments.payoutBatchId)))
      .returning({ id: payments.id });
    // A concurrent sender replayed the same request id and stored the same batch first.
    if (rows.length === 0) return;
    await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "payout_sent", data: { milestoneId: m.id, paymentId: p.id, batchId: batch.batchId, amount: p.payoutAmount } });
  });
  return reconcilePayout(db, api, p.id);
}

/** Stop the payout for a human: refused (failed) or outcome unknown. Never overwrites a stored batch. */
async function markPayoutStopped(db: Db, paymentId: string, status: "payout_failed" | "payout_unknown", payoutStatus: string): Promise<void> {
  const p = await paymentById(db, paymentId);
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m || PAYOUT_STOPPED.has(p.status)) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(payments)
      .set({ status, payoutStatus, ...bump() })
      .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion), isNull(payments.payoutBatchId)))
      .returning({ id: payments.id });
    if (rows.length === 0) return;
    const data = { milestoneId: m.id, paymentId: p.id, status: payoutStatus };
    // An unknown outcome is audited as a sent payout request whose result PayPal didn't confirm.
    await appendAudit(tx, { projectId: m.projectId, actorId: null, action: status === "payout_failed" ? "payout_failed" : "payout_sent", data: status === "payout_failed" ? data : { ...data, outcome: "unknown" } });
  });
}

/** Read the payout batch back from PayPal: SUCCESS moves RELEASED -> PAID; a failed item is flagged once. */
export async function reconcilePayout(db: Db, api: PaypalApi, paymentId: string): Promise<StateResult<PayoutError>> {
  const first = await paymentById(db, paymentId);
  if (!first) return { ok: false, error: "not_found" };
  const m0 = await loadMilestone(db, first.milestoneId);
  if (!m0) return { ok: false, error: "not_found" };
  if (!first.payoutBatchId) return { ok: true, value: { state: m0.state } };
  let item: { itemId: string | null; status: string };
  try {
    const b = await api.getPayoutBatch(first.payoutBatchId);
    // Without an item, only the batch status is known: it can fail the payout but never mark it paid.
    const i = b.items[0];
    item = i ? { itemId: i.itemId, status: i.status ?? b.batchStatus } : { itemId: null, status: b.batchStatus };
  } catch (e) {
    return { ok: false, error: paypalFailure(e) };
  }

  const r = await retryOnRace(async (): Promise<StateResult<PayoutError> | typeof LOST_RACE> => {
    const p = await paymentById(db, paymentId);
    const m = p && (await loadMilestone(db, p.milestoneId));
    if (!p || !m) return { ok: false, error: "not_found" };
    const changed = p.payoutItemId !== item.itemId || p.payoutStatus !== item.status;
    const paid = item.status === "SUCCESS" && item.itemId !== null;
    const event: MilestoneEvent | null = paid && m.state === "RELEASED" ? "payout_succeeded" : null;
    if (!changed && !event) {
      await db.update(payments).set({ lastReconciledAt: new Date() }).where(eq(payments.id, p.id));
      return { ok: true, value: { state: m.state } };
    }
    const failed = FAILED_PAYOUT.has(item.status);
    const status = paid ? "paid" : failed ? "payout_failed" : "payout_pending";
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(payments)
        .set({ payoutItemId: item.itemId, payoutStatus: item.status, status, ...bump() })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion)))
        .returning({ id: payments.id });
      if (rows.length === 0) throw new Error(LOST_RACE);
      let state = m.state;
      if (event) {
        const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: m.state, expectedVersion: m.stateVersion, event });
        if (!moved.ok) throw new Error(LOST_RACE);
        state = moved.value.state;
      }
      const data = { milestoneId: m.id, paymentId: p.id, batchId: p.payoutBatchId, itemId: item.itemId, status: item.status };
      if (event) await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "payout_succeeded", data });
      else if (failed && p.status !== "payout_failed") await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "payout_failed", data });
      return { ok: true, value: { state } };
    });
  });
  return r === "conflict" ? { ok: false, error: "conflict" } : r;
}
