// The payment timeline read model: one milestone's payment as four steps (hold, approval, capture, payout),
// each with PayPal's own id and status as last read back, plus the fee breakdown and at most one notice.
// Pure: the page passes the stored payment row and the milestone state; nothing here calls PayPal.
import type { MilestoneState } from "../milestones/state-machine";
import { moneyToCents } from "../projects/money";
import type { PaymentRow } from "./context";

export type TimelineInput = Pick<
  PaymentRow,
  | "status"
  | "authorizationId"
  | "authorizationStatus"
  | "authorizationExpiresAt"
  | "honorPeriodEndsAt"
  | "approvedAt"
  | "captureId"
  | "captureStatus"
  | "payoutBatchId"
  | "payoutItemId"
  | "payoutStatus"
  | "amount"
  | "fee"
  | "payoutAmount"
  | "lastReconciledAt"
>;

export type StepStatus = "done" | "current" | "waiting" | "problem";
export type TimelineStep = {
  key: "hold" | "approved" | "captured" | "paid";
  status: StepStatus;
  paypalId: string | null;
  paypalStatus: string | null;
};

export type TimelineNotice =
  | { kind: "honor_period"; honorEndsAt: Date; expiresAt: Date }
  | { kind: "honor_period_over"; expiresAt: Date }
  | { kind: "capture_pending" }
  | { kind: "capture_denied" }
  | { kind: "capture_refunded" }
  | { kind: "payout_failed" }
  | { kind: "payout_unknown" }
  | { kind: "refund_needed" }
  | { kind: "voided" };

export type PaymentTimeline = {
  steps: TimelineStep[];
  fee: { amountCents: number; feeCents: number; payoutCents: number };
  notice: TimelineNotice | null;
  /** When PayPal was last read back for this payment; the step statuses are as of this time. */
  checkedAt: Date | null;
  /** The hold is gone (expired or voided) after work started: approval is blocked until the client re-funds. */
  refundNeeded: boolean;
};

// Same set as release.ts CAPTURE_REFUNDED, copied so this pure read model doesn't import release.ts (DB, PayPal).
const REFUNDED = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"]);
const PRE_CAPTURE =new Set<MilestoneState>(["FUNDED", "SUBMITTED", "VERIFYING", "REPORT_READY", "DISPUTED", "APPROVED"]);

export function buildTimeline(p: TimelineInput, state: MilestoneState, now: Date): PaymentTimeline {
  const lost = p.status === "authorization_lost";
  const voided = p.status === "voided" || state === "CANCELLED";
  const denied = p.status === "capture_denied";
  // Read from the capture's own status: after a payout the row's status belongs to the payout.
  const refunded = p.captureStatus !== null && REFUNDED.has(p.captureStatus);
  const payoutStopped = p.status === "payout_failed" || p.status === "payout_unknown";
  const captured = p.captureStatus === "COMPLETED";
  const paid = state === "PAID" || p.status === "paid";

  const steps: TimelineStep[] = [
    // Capture and payout reconciles don't re-read the authorization, so its stored status goes stale
    // (CREATED while PayPal says CAPTURED) once a capture exists; show only the id then.
    {
      key: "hold",
      status: lost || voided ? "problem" : p.authorizationId ? "done" : "current",
      paypalId: p.authorizationId,
      paypalStatus: p.captureId ? null : p.authorizationStatus,
    },
    { key: "approved", status: voided ? "waiting" : p.approvedAt ? "done" : "waiting", paypalId: null, paypalStatus: null },
    {
      key: "captured",
      status: denied || refunded ? "problem" : captured ? "done" : p.captureId ? "current" : "waiting",
      paypalId: p.captureId,
      paypalStatus: p.captureStatus,
    },
    {
      key: "paid",
      status: payoutStopped ? "problem" : paid ? "done" : p.payoutBatchId ? "current" : "waiting",
      paypalId: p.payoutBatchId,
      paypalStatus: p.payoutStatus,
    },
  ];

  return {
    steps,
    fee: { amountCents: moneyToCents(p.amount), feeCents: p.fee ? moneyToCents(p.fee) : 0, payoutCents: p.payoutAmount ? moneyToCents(p.payoutAmount) : 0 },
    notice: notice(p, state, now, { lost, voided, denied }),
    checkedAt: p.lastReconciledAt,
    refundNeeded: lost,
  };
}

function notice(p: TimelineInput, state: MilestoneState, now: Date, f: { lost: boolean; voided: boolean; denied: boolean }): TimelineNotice | null {
  if (f.lost) return { kind: "refund_needed" };
  if (f.voided) return { kind: "voided" };
  if (f.denied) return { kind: "capture_denied" };
  if (p.captureStatus !== null && REFUNDED.has(p.captureStatus)) return { kind: "capture_refunded" };
  if (p.status === "payout_failed" || p.status === "payout_unknown") return { kind: p.status };
  if (state === "CAPTURE_PENDING") return { kind: "capture_pending" };
  if (PRE_CAPTURE.has(state) && p.authorizationExpiresAt && p.honorPeriodEndsAt) {
    return now < p.honorPeriodEndsAt
      ? { kind: "honor_period", honorEndsAt: p.honorPeriodEndsAt, expiresAt: p.authorizationExpiresAt }
      : { kind: "honor_period_over", expiresAt: p.authorizationExpiresAt };
  }
  return null;
}
