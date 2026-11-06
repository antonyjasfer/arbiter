// Reconcile one payment from PayPal's read-back, on a poll or a page view (and, in Task 6, after a
// verified webhook). Webhooks are never trusted for state and may never arrive (localhost, a Render
// cold start, a deploy), so this is what moves a settled capture to RELEASED and on to the payout.
// Members only; at most one PayPal round per payment every 30 s. Every move goes through release.ts, so
// the guard runs before the payout and replays are no-ops.
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import type { MilestoneState } from "../milestones/state-machine";
import { loadMilestone, milestoneForRole } from "./context";
import type { PaypalApi } from "./paypal-api";
import { PAYOUT_STOPPED, reconcileCapture, reconcilePayout, sendPayout } from "./release";

export const RECONCILE_EVERY_MS = 30_000;

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
  if (state === "CAPTURE_PENDING") {
    const r = await reconcileCapture(db, api, paymentId);
    if (!r.ok) return r.error;
    state = r.value.state;
  }
  if (state === "RELEASED") {
    const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) return "not_found";
    // A refused, failed or unknown payout is left for a human; polling never retries it.
    if (!p.payoutBatchId && PAYOUT_STOPPED.has(p.status)) return null;
    const r = p.payoutBatchId ? await reconcilePayout(db, api, paymentId) : await sendPayout(db, api, paymentId);
    return r.ok ? null : r.error;
  }
  // Other states have nothing to read back yet (authorization read-back: Task 5/6).
  return null;
}

async function view(db: Db, paymentId: string, lastError: string | null): Promise<Result<PaymentView, "not_found">> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  return { ok: true, value: { state: m.state, paymentStatus: p.status, captureStatus: p.captureStatus, payoutStatus: p.payoutStatus, lastError } };
}
