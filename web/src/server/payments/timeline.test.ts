import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineInput } from "./timeline";

const AUTH_AT = new Date("2026-11-07T10:51:43Z");
const HONOR_END = new Date("2026-11-10T10:51:43Z");
const EXPIRES = new Date("2026-12-06T10:51:43Z");

function payment(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    status: "authorized",
    authorizationId: "2JT4063409777392S",
    authorizationStatus: "CREATED",
    authorizationExpiresAt: EXPIRES,
    honorPeriodEndsAt: HONOR_END,
    approvedAt: null,
    captureId: null,
    captureStatus: null,
    payoutBatchId: null,
    payoutItemId: null,
    payoutStatus: null,
    amount: "200.00",
    fee: "11.00",
    payoutAmount: "189.00",
    lastReconciledAt: AUTH_AT,
    ...over,
  };
}

const steps = (t: ReturnType<typeof buildTimeline>) => t.steps.map((s) => `${s.key}:${s.status}`);

describe("buildTimeline", () => {
  it("breaks down the fee in cents from the stored payment", () => {
    const t = buildTimeline(payment(), "FUNDED", AUTH_AT);
    expect(t.fee).toEqual({ amountCents: 20000, feeCents: 1100, payoutCents: 18900 });
  });

  it("funded: hold placed with PayPal's id and status, the rest waiting, and the honor-period note", () => {
    const t = buildTimeline(payment(), "FUNDED", AUTH_AT);
    expect(steps(t)).toEqual(["hold:done", "approved:waiting", "captured:waiting", "paid:waiting"]);
    expect(t.steps[0]).toMatchObject({ paypalId: "2JT4063409777392S", paypalStatus: "CREATED" });
    expect(t.notice).toMatchObject({ kind: "honor_period", honorEndsAt: HONOR_END, expiresAt: EXPIRES });
    expect(t.refundNeeded).toBe(false);
  });

  it("after the honor period, says the hold is no longer guaranteed until it expires", () => {
    const t = buildTimeline(payment(), "REPORT_READY", new Date("2026-11-11T00:00:00Z"));
    expect(t.notice).toMatchObject({ kind: "honor_period_over", expiresAt: EXPIRES });
  });

  it("capture pending: the honest settling copy, captured step current with PayPal's status", () => {
    const t = buildTimeline(
      payment({ status: "capture_pending", approvedAt: AUTH_AT, captureId: "24140907B72033302", captureStatus: "PENDING" }),
      "CAPTURE_PENDING",
      AUTH_AT,
    );
    expect(steps(t)).toEqual(["hold:done", "approved:done", "captured:current", "paid:waiting"]);
    expect(t.steps[2]).toMatchObject({ paypalId: "24140907B72033302", paypalStatus: "PENDING" });
    expect(t.notice).toMatchObject({ kind: "capture_pending" });
  });

  it("once a capture exists, hides the hold's stored status (never refreshed after capture) but keeps its id", () => {
    const t = buildTimeline(
      payment({ status: "capture_pending", approvedAt: AUTH_AT, captureId: "24140907B72033302", captureStatus: "PENDING" }),
      "CAPTURE_PENDING",
      AUTH_AT,
    );
    expect(t.steps[0]).toMatchObject({ status: "done", paypalId: "2JT4063409777392S", paypalStatus: null });
  });

  it("carries when PayPal was last read, so the UI can say how fresh the statuses are", () => {
    const at = new Date("2026-11-08T10:57:39Z");
    expect(buildTimeline(payment({ lastReconciledAt: at }), "FUNDED", AUTH_AT).checkedAt).toEqual(at);
    expect(buildTimeline(payment({ lastReconciledAt: null }), "FUNDED", AUTH_AT).checkedAt).toBeNull();
  });

  it("released with a payout sent: paid step current with the batch id", () => {
    const t = buildTimeline(
      payment({ status: "payout_pending", approvedAt: AUTH_AT, captureId: "C1", captureStatus: "COMPLETED", payoutBatchId: "B1", payoutItemId: "I1", payoutStatus: "PENDING" }),
      "RELEASED",
      AUTH_AT,
    );
    expect(steps(t)).toEqual(["hold:done", "approved:done", "captured:done", "paid:current"]);
    expect(t.steps[3]).toMatchObject({ paypalId: "B1", paypalStatus: "PENDING" });
    expect(t.notice).toBeNull();
  });

  it("paid: every step done, no notice", () => {
    const t = buildTimeline(
      payment({ status: "paid", approvedAt: AUTH_AT, captureId: "C1", captureStatus: "COMPLETED", payoutBatchId: "B1", payoutItemId: "I1", payoutStatus: "SUCCESS" }),
      "PAID",
      AUTH_AT,
    );
    expect(steps(t)).toEqual(["hold:done", "approved:done", "captured:done", "paid:done"]);
    expect(t.notice).toBeNull();
  });

  it("capture denied: captured step is a problem", () => {
    const t = buildTimeline(payment({ status: "capture_denied", approvedAt: AUTH_AT, captureId: "C1", captureStatus: "DECLINED" }), "APPROVED", AUTH_AT);
    expect(t.steps[2]!.status).toBe("problem");
    expect(t.notice).toMatchObject({ kind: "capture_denied" });
  });

  it.each(["payout_failed", "payout_unknown"])("%s: paid step is a problem with a notice for a human", (status) => {
    const t = buildTimeline(payment({ status, approvedAt: AUTH_AT, captureId: "C1", captureStatus: "COMPLETED" }), "RELEASED", AUTH_AT);
    expect(t.steps[3]!.status).toBe("problem");
    expect(t.notice).toMatchObject({ kind: status });
  });

  it("authorization lost: hold step is a problem and re-fund is needed, with no honor-period note", () => {
    const t = buildTimeline(payment({ status: "authorization_lost", authorizationStatus: "EXPIRED" }), "REPORT_READY", AUTH_AT);
    expect(t.steps[0]).toMatchObject({ status: "problem", paypalStatus: "EXPIRED" });
    expect(t.refundNeeded).toBe(true);
    expect(t.notice).toMatchObject({ kind: "refund_needed" });
  });

  it("cancelled (voided): hold step shows VOIDED and nothing else is pending", () => {
    const t = buildTimeline(payment({ status: "voided", authorizationStatus: "VOIDED" }), "CANCELLED", AUTH_AT);
    expect(steps(t)).toEqual(["hold:problem", "approved:waiting", "captured:waiting", "paid:waiting"]);
    expect(t.notice).toMatchObject({ kind: "voided" });
  });
});
