import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { createFakePaypal } from "./fake-paypal";
import type { LatestVerdicts } from "./guard";
import { PaypalApiError } from "./paypal-api";
import { reconcilePayment, reconcileWebhookResource } from "./reconcile";
import { approveRelease } from "./release";
import { auditActions, fundMilestone, lockedProject, milestoneRow, paymentRows, toReportReady, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
let pp: ReturnType<typeof createFakePaypal>;
const allPass: LatestVerdicts = async () => ["pass"];
const later = (secs: number) => new Date(Date.now() + secs * 1000);

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  pp = createFakePaypal();
  await fundMilestone(db(), pp, f, m1);
  await toReportReady(db(), m1);
});

const live = async () => (await paymentRows(db(), m1)).find((p) => !p.supersededAt)!;
const poll = async (userId: string, now = later(31)) => reconcilePayment(db(), pp.api, { userId, paymentId: (await live()).id, now });
const paypalCalls = () => pp.calls.length;

describe("reconcilePayment (poll and page view)", () => {
  it("refuses a non-member and a malformed id before any PayPal call", async () => {
    const before = paypalCalls();
    expect(await poll(f.outsider)).toEqual({ ok: false, error: "not_found" });
    expect(await reconcilePayment(db(), pp.api, { userId: f.client, paymentId: "x", now: later(31) })).toEqual({ ok: false, error: "not_found" });
    expect(paypalCalls()).toBe(before);
  });

  it("a capture that settles later is picked up by a poll, and the payout follows to PAID (no webhook)", async () => {
    pp.setNextCaptureStatus("PENDING", "PENDING_REVIEW");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    expect(await poll(f.client)).toMatchObject({ ok: true, value: { state: "CAPTURE_PENDING" } });
    pp.setCaptureStatus((await live()).captureId!, "COMPLETED");
    expect(await poll(f.freelancer, later(62))).toMatchObject({ ok: true, value: { state: "PAID", paymentStatus: "paid" } });
    expect(pp.batches.size).toBe(1);
    expect(await auditActions(db(), f.projectId)).toEqual(expect.arrayContaining(["capture_completed", "payout_sent", "payout_succeeded"]));
  });

  it("a RELEASED milestone whose payout never started (a crash after capture) is paid by the next poll", async () => {
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    expect((await milestoneRow(db(), m1)).state).toBe("RELEASED");
    expect(await poll(f.client)).toMatchObject({ ok: true, value: { state: "PAID" } });
    expect(pp.batches.size).toBe(1);
  });

  it("polls within 30 s of the last reconcile make no PayPal calls", async () => {
    pp.setNextCaptureStatus("PENDING");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    const before = paypalCalls();
    expect(await poll(f.client, new Date())).toMatchObject({ ok: true, value: { state: "CAPTURE_PENDING" } });
    expect(paypalCalls()).toBe(before);
  });

  it("two members polling at the same moment run one PayPal round (the 30 s slot is claimed atomically)", async () => {
    pp.setNextCaptureStatus("PENDING");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    pp.setCaptureStatus((await live()).captureId!, "COMPLETED");
    const id = (await live()).id;
    const now = later(31);
    await Promise.all([
      reconcilePayment(db(), pp.api, { userId: f.client, paymentId: id, now }),
      reconcilePayment(db(), pp.api, { userId: f.freelancer, paymentId: id, now }),
    ]);
    expect(pp.count("createPayout")).toBe(1);
    // One round: the capture read-back, the guard's read-back before the payout.
    expect(pp.count("getCapture")).toBe(2);
  });

  it("review I2: an APPROVED milestone whose capture call failed is captured by the next poll, once, with the same request id", async () => {
    pp.failNext("captureAuthorization", new Error("network timeout"));
    expect(await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass })).toMatchObject({ ok: false });
    expect((await milestoneRow(db(), m1)).state).toBe("APPROVED");
    expect(await poll(f.freelancer)).toMatchObject({ ok: true, value: { state: "PAID" } });
    const captures = pp.calls.filter((c) => c.op === "captureAuthorization");
    expect(captures).toHaveLength(2);
    expect(captures[0]!.requestId).toBe(captures[1]!.requestId);
    expect(pp.captures.size).toBe(1);
    expect(pp.batches.size).toBe(1);
  });

  it("a DECLINED capture is not retried by polling", async () => {
    pp.setNextCaptureStatus("DECLINED");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    expect(await poll(f.client)).toMatchObject({ ok: true, value: { state: "APPROVED", paymentStatus: "capture_denied" } });
    expect(pp.count("captureAuthorization")).toBe(1);
  });

  it("a failed payout is not retried by polling", async () => {
    pp.setNextPayoutItemStatus("FAILED");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    await poll(f.client);
    await poll(f.client, later(62));
    expect(pp.count("createPayout")).toBe(1);
    expect(await live()).toMatchObject({ status: "payout_failed" });
  });

  it("a superseded payment row is not reconciled", async () => {
    const p = await live();
    await db().update(s.payments).set({ supersededAt: new Date() }).where(eq(s.payments.id, p.id));
    expect(await reconcilePayment(db(), pp.api, { userId: f.client, paymentId: p.id, now: later(31) })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("reconcileWebhookResource (after a verified webhook)", () => {
  const hook = (resourceType: string, resourceId: string) => reconcileWebhookResource(db(), pp.api, { resourceType, resourceId });
  const writes = () => pp.calls.filter((c) => ["createOrder", "authorizeOrder", "captureAuthorization", "createPayout"].includes(c.op)).length;
  const pendingCapture = async () => {
    pp.setNextCaptureStatus("PENDING", "PENDING_REVIEW");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    return (await live()).captureId!;
  };

  it("CAPTURE.COMPLETED: the read-back moves CAPTURE_PENDING -> RELEASED and the payout follows to PAID", async () => {
    const cap = await pendingCapture();
    pp.setCaptureStatus(cap, "COMPLETED");
    expect(await hook("capture", cap)).toEqual({ outcome: "reconciled", state: "PAID" });
    expect(pp.batches.size).toBe(1);
  });

  it("the event body is never trusted: a capture event while PayPal still says PENDING moves nothing", async () => {
    const cap = await pendingCapture();
    expect(await hook("capture", cap)).toEqual({ outcome: "reconciled", state: "CAPTURE_PENDING" });
    expect(pp.batches.size).toBe(0);
  });

  it("duplicates and any arrival order end in the same state with one payout", async () => {
    const cap = await pendingCapture();
    pp.setCaptureStatus(cap, "COMPLETED");
    await hook("capture", cap);
    const item = [...pp.batches.values()][0]!.items[0]!.itemId;
    const batch = (await live()).payoutBatchId!;
    // Payout events, then the capture event again (late), then duplicates.
    for (const [t, id] of [["payouts_item", item], ["payouts", batch], ["capture", cap], ["capture", cap], ["payouts_item", item]] as const) {
      expect(await hook(t, id)).toMatchObject({ outcome: "reconciled", state: "PAID" });
    }
    expect(pp.count("createPayout")).toBe(1);
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "payout_succeeded")).toHaveLength(1);
  });

  it("CAPTURE.DENIED: CAPTURE_PENDING goes back to APPROVED, nothing is paid", async () => {
    const cap = await pendingCapture();
    pp.setCaptureStatus(cap, "DECLINED");
    expect(await hook("capture", cap)).toEqual({ outcome: "reconciled", state: "APPROVED" });
    expect(await live()).toMatchObject({ status: "capture_denied", captureStatus: "DECLINED" });
    expect(pp.count("createPayout")).toBe(0);
    expect(await auditActions(db(), f.projectId)).toContain("capture_denied");
  });

  it("REFUNDED after payout (refund resource): flagged for a human once, state kept, no clawback or other PayPal write", async () => {
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    await poll(f.client);
    expect((await milestoneRow(db(), m1)).state).toBe("PAID");
    const before = writes();
    const ref = pp.refundCapture((await live()).captureId!);
    expect(await hook("refund", ref)).toEqual({ outcome: "reconciled", state: "PAID" });
    expect(await hook("refund", ref)).toEqual({ outcome: "reconciled", state: "PAID" });
    expect(await live()).toMatchObject({ captureStatus: "REFUNDED", status: "paid" });
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "capture_refunded")).toHaveLength(1);
    expect(writes()).toBe(before);
  });

  it("REVERSED reported on the capture itself is flagged the same way", async () => {
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    await poll(f.client);
    const cap = (await live()).captureId!;
    pp.refundCapture(cap, "REVERSED");
    expect(await hook("capture", cap)).toEqual({ outcome: "reconciled", state: "PAID" });
    expect(await auditActions(db(), f.projectId)).toContain("capture_refunded");
  });

  it("a refunded capture before the payout stops the payout", async () => {
    pp.setNextPayoutItemStatus("PENDING");
    const cap = await pendingCapture();
    pp.refundCapture(cap);
    expect(await hook("capture", cap)).toEqual({ outcome: "reconciled", state: "CAPTURE_PENDING" });
    expect(pp.count("createPayout")).toBe(0);
  });

  it("a payout item event for an item not stored yet finds its batch and moves RELEASED -> PAID", async () => {
    pp.setNextPayoutItemStatus("PENDING");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    expect(await poll(f.client)).toMatchObject({ ok: true, value: { state: "RELEASED" } });
    const b = [...pp.batches.values()][0]!;
    // The webhook can beat the read-back that stores the item id.
    await db().update(s.payments).set({ payoutItemId: null }).where(eq(s.payments.id, (await live()).id));
    pp.setPayoutItemStatus(b.batchId, "SUCCESS");
    expect(await hook("payouts_item", b.items[0]!.itemId)).toEqual({ outcome: "reconciled", state: "PAID" });
    expect(pp.count("getPayoutItem")).toBe(1);
  });

  it("resources that match no payment, and unsupported types, change nothing", async () => {
    expect(await hook("capture", "NOPE1")).toEqual({ outcome: "no_payment" });
    expect(await hook("payouts", "NOPE2")).toEqual({ outcome: "no_payment" });
    expect(await hook("checkout-order", "ORDER1")).toEqual({ outcome: "ignored" });
    expect(await hook("capture", "../etc")).toEqual({ outcome: "ignored" });
    expect(pp.count("getCapture")).toBe(0);
  });

  it("PayPal unreachable on the read-back: asks for a retry (PayPal redelivers) and changes nothing", async () => {
    const cap = await pendingCapture();
    pp.failNext("getCapture", new PaypalApiError(503, "SERVICE_UNAVAILABLE"));
    expect(await hook("capture", cap)).toEqual({ outcome: "retry" });
    expect((await milestoneRow(db(), m1)).state).toBe("CAPTURE_PENDING");
  });
});
