// Reconcile one payment from PayPal's read-back, on a poll or a page view, or after a verified webhook. Webhooks are never trusted for state and may never arrive (localhost, a Render
// cold start, a deploy), so this is what moves a settled capture to RELEASED and on to the payout.
// Members only; at most one PayPal round per payment every 30 s. Every move goes through release.ts, so
// the guard runs before the payout and replays are no-ops.
import { and, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import type { MilestoneState } from "../milestones/state-machine";
import { loadMilestone, milestoneForRole } from "./context";
import { PaypalApiError, type PaypalApi } from "./paypal-api";
import { reconcileAuthorization } from "./lost-authorization";
import { CAPTURE_REFUNDED, captureApproved, PAYOUT_STOPPED, reconcileCapture, reconcilePayout, sendPayout } from "./release";

export const RECONCILE_EVERY_MS = 30_000;
// States where the payment is an uncaptured PayPal hold.
const HOLD_STATES = new Set<MilestoneState>(["FUNDED", "SUBMITTED", "VERIFYING", "REPORT_READY", "DISPUTED", "APPROVED"]);

export type PaymentView = {
  state: MilestoneState;
  paymentStatus: string;
  captureStatus: string | null;
  payoutStatus: string | null;
  /** The last step's error code if PayPal could not be reached or refused; the next poll retries. */
  lastError: string | null;
};

export async function reconcilePayment(
  db: Db,
  api: PaypalApi,
  args: { userId: string; paymentId: string; now?: Date },
): Promise<Result<PaymentView, "not_found">> {
  if (!parseId(args.paymentId)) return { ok: false, error: "not_found" };
  const [p] = await db.select().from(payments).where(eq(payments.id, args.paymentId));
  if (!p || p.supersededAt) return { ok: false, error: "not_found" };
  const access = await milestoneForRole(db, { userId: args.userId, milestoneId: p.milestoneId, allowed: ["client", "freelancer"] });
  if (!access.ok) return { ok: false, error: "not_found" };

  const claimed = await claimRound(db, p.id, args.now ?? new Date());
  const lastError = claimed ? await advance(db, api, p.id, access.value.milestone.state) : null;
  return view(db, p.id, lastError);
}

/**
 * Claim this payment's reconcile slot: one UPDATE that succeeds only if no round ran in the last 30 s, so
 * concurrent polls (client and freelancer both watching) run one PayPal round, and a PayPal outage is
 * retried at most every 30 s.
 */
async function claimRound(db: Db, paymentId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - RECONCILE_EVERY_MS);
  const rows = await db
    .update(payments)
    .set({ lastReconciledAt: now })
    .where(and(eq(payments.id, paymentId), or(isNull(payments.lastReconciledAt), lt(payments.lastReconciledAt, cutoff))))
    .returning({ id: payments.id });
  return rows.length > 0;
}

/** One reconcile round. Returns an error code, or null. */
async function advance(db: Db, api: PaypalApi, paymentId: string, state: MilestoneState): Promise<string | null> {
  if (HOLD_STATES.has(state)) {
    // Before a capture, the hold itself can be lost (expired or voided outside Arbiter).
    const r = await reconcileAuthorization(db, api, paymentId);
    if (!r.ok) return r.error;
    state = r.value.state;
  }
  if (state === "APPROVED") {
    // The client's approval is recorded but the capture call failed or timed out (review I2). Retry it with
    // the stored request id, so PayPal replays a capture it already made instead of capturing twice.
    // Only while the row is still "approved": a denied capture or a lost hold is left for a human.
    const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
    if (p?.status !== "approved") return null;
    const r = await captureApproved(db, api, paymentId);
    if (!r.ok) return r.error;
    state = r.value.state;
  }
  if (state === "CAPTURE_PENDING") {
    const r = await reconcileCapture(db, api, paymentId);
    if (!r.ok) return r.error;
    state = r.value.state;
  }
  if (state === "RELEASED") {
    const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) return "not_found";
    // A refused, failed or unknown payout, or a refunded capture, is left for a human; polling never retries it.
    if (!p.payoutBatchId && (PAYOUT_STOPPED.has(p.status) || (p.captureStatus !== null && CAPTURE_REFUNDED.has(p.captureStatus)))) return null;
    const r = p.payoutBatchId ? await reconcilePayout(db, api, paymentId) : await sendPayout(db, api, paymentId);
    return r.ok ? null : r.error;
  }
  return null;
}

async function view(db: Db, paymentId: string, lastError: string | null): Promise<Result<PaymentView, "not_found">> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  return { ok: true, value: { state: m.state, paymentStatus: p.status, captureStatus: p.captureStatus, payoutStatus: p.payoutStatus, lastError } };
}

export type WebhookOutcome =
  | { outcome: "reconciled"; state: MilestoneState }
  /** The resource belongs to no payment of ours (or not yet): nothing to do. */
  | { outcome: "no_payment" }
  /** A resource type that moves no payment state (orders: funding completes in the app), or a bad id. */
  | { outcome: "ignored" }
  /** PayPal couldn't be read: the webhook route answers 500 so PayPal redelivers. */
  | { outcome: "retry" };

const PAYPAL_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * After a verified webhook: find the payment the event's resource belongs to and run the same guarded
 * read-back as a poll. The event body only says where to look; state always comes from PayPal's GET, so
 * order and duplicates don't matter. System actor: no member check (the event was verified with PayPal).
 * Authorization events run the lost-authorization read-back.
 */
export async function reconcileWebhookResource(db: Db, api: PaypalApi, r: { resourceType: string; resourceId: string }): Promise<WebhookOutcome> {
  if (!PAYPAL_ID.test(r.resourceId)) return { outcome: "ignored" };
  try {
    switch (r.resourceType) {
      case "capture":
        return await viaCapture(db, api, r.resourceId);
      case "refund": {
        const refund = await api.getRefund(r.resourceId);
        return refund.captureId ? await viaCapture(db, api, refund.captureId) : { outcome: "no_payment" };
      }
      case "authorization": {
        const [p] = await db.select({ id: payments.id }).from(payments).where(eq(payments.authorizationId, r.resourceId));
        if (!p) return { outcome: "no_payment" };
        const a = await reconcileAuthorization(db, api, p.id);
        return a.ok ? { outcome: "reconciled", state: a.value.state } : outcomeOf(a.error);
      }
      case "payouts":
        return await viaPayout(db, api, eq(payments.payoutBatchId, r.resourceId));
      case "payouts_item": {
        const [stored] = await db.select({ id: payments.id }).from(payments).where(eq(payments.payoutItemId, r.resourceId));
        if (stored) return await viaPayout(db, api, eq(payments.id, stored.id));
        // The batch POST returns no items, so the item id may not be stored yet: ask PayPal for its batch.
        const item = await api.getPayoutItem(r.resourceId);
        return await viaPayout(db, api, eq(payments.payoutBatchId, item.batchId));
      }
      default:
        return { outcome: "ignored" };
    }
  } catch (e) {
    if (e instanceof PaypalApiError && e.status === 404) return { outcome: "no_payment" };
    if (e instanceof PaypalApiError && e.status < 500) throw e;
    return { outcome: "retry" };
  }
}

async function viaCapture(db: Db, api: PaypalApi, captureId: string): Promise<WebhookOutcome> {
  const [p] = await db.select({ id: payments.id }).from(payments).where(eq(payments.captureId, captureId));
  if (!p) return { outcome: "no_payment" };
  const r = await reconcileCapture(db, api, p.id);
  if (!r.ok) return outcomeOf(r.error);
  if (r.value.state !== "RELEASED") return { outcome: "reconciled", state: r.value.state };
  const err = await advance(db, api, p.id, "RELEASED");
  return err ? outcomeOf(err) : reconciledState(db, p.id);
}

async function viaPayout(db: Db, api: PaypalApi, where: SQL): Promise<WebhookOutcome> {
  const [p] = await db.select({ id: payments.id }).from(payments).where(where);
  if (!p) return { outcome: "no_payment" };
  const r = await reconcilePayout(db, api, p.id);
  return r.ok ? { outcome: "reconciled", state: r.value.state } : outcomeOf(r.error);
}

function outcomeOf(error: string): WebhookOutcome {
  if (error === "paypal_unavailable" || error === "conflict") return { outcome: "retry" };
  if (error === "not_found") return { outcome: "no_payment" };
  // A refused read or a guard refusal (amount mismatch, payout stopped): a redelivery wouldn't change it.
  throw new Error(`payment reconcile refused: ${error}`);
}

async function reconciledState(db: Db, paymentId: string): Promise<WebhookOutcome> {
  const [p] = await db.select({ milestoneId: payments.milestoneId }).from(payments).where(eq(payments.id, paymentId));
  const m = p && (await loadMilestone(db, p.milestoneId));
  return m ? { outcome: "reconciled", state: m.state } : { outcome: "no_payment" };
}
