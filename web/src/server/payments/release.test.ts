import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { createFakePaypal } from "./fake-paypal";
import type { LatestVerdicts } from "./guard";
import { PaypalApiError } from "./paypal-api";
import { approveRelease, reconcileCapture, reconcilePayout, sendPayout } from "./release";
import { auditActions, FREELANCER_EMAIL, fundMilestone, lockedProject, milestoneRow, paymentRows, toReportReady, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
let pp: ReturnType<typeof createFakePaypal>;
const allPass: LatestVerdicts = async () => ["pass"];
const oneFail: LatestVerdicts = async () => ["pass", "fail"];
const REASON = "The failing check was a flaky network test; I reviewed the demo myself.";

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  pp = createFakePaypal();
  await fundMilestone(db(), pp, f, m1);
  await toReportReady(db(), m1);
});

const approve = (over: Partial<Parameters<typeof approveRelease>[2]> = {}) =>
  approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass, ...over });
const live = async () => (await paymentRows(db(), m1)).find((p) => !p.supersededAt)!;
const state = async () => (await milestoneRow(db(), m1)).state;

describe("approveRelease", () => {
  it("records the approval, captures the full amount with a stored request id, and a COMPLETED capture releases", async () => {
    expect(await approve()).toEqual({ ok: true, value: { state: "RELEASED" } });
    const p = await live();
    expect(p).toMatchObject({ approvedBy: f.client, status: "captured", captureStatus: "COMPLETED", overrideReason: null });
    expect(p.captureId).toMatch(/^CAP/);
    const rid = (p.requestIds as Record<string, string>).capture;
    expect(pp.calls.find((c) => c.op === "captureAuthorization")?.requestId).toBe(rid);
    expect([...pp.captures.values()][0]).toMatchObject({ amountCents: 5000, authorizationId: p.authorizationId });
    expect(await auditActions(db(), f.projectId)).toEqual(expect.arrayContaining(["release_approved", "capture_completed"]));
  });

  it("a PENDING capture moves to CAPTURE_PENDING and keeps PayPal's reason", async () => {
    pp.setNextCaptureStatus("PENDING", "PENDING_REVIEW");
    expect(await approve()).toEqual({ ok: true, value: { state: "CAPTURE_PENDING" } });
    expect(await live()).toMatchObject({ status: "capture_pending", captureStatus: "PENDING" });
    expect(await auditActions(db(), f.projectId)).toContain("capture_pending");
  });

  it("a DECLINED capture leaves the milestone APPROVED and is audited", async () => {
    pp.setNextCaptureStatus("DECLINED");
    expect(await approve()).toEqual({ ok: true, value: { state: "APPROVED" } });
    expect(await live()).toMatchObject({ status: "capture_denied", captureStatus: "DECLINED" });
    expect(await auditActions(db(), f.projectId)).toContain("capture_denied");
  });

  it("review I3: a DECLINED capture is flagged for a human in the audit log and never retried", async () => {
    pp.setNextCaptureStatus("DECLINED");
    await approve();
    const [row] = await db().select().from(s.auditEvents).where(eq(s.auditEvents.action, "capture_denied"));
    expect(row!.data).toMatchObject({ status: "DECLINED", needsHuman: true });
    // Approving again is a no-op that reports the state; it never captures a second time.
    expect(await approve()).toEqual({ ok: true, value: { state: "APPROVED" } });
    expect(pp.count("captureAuthorization")).toBe(1);
  });

  it("a guard refusal happens before any PayPal call and records nothing", async () => {
    expect(await approve({ userId: f.freelancer })).toEqual({ ok: false, error: "forbidden" });
    expect(await approve({ latestVerdicts: oneFail })).toEqual({ ok: false, error: "fail_without_override" });
    expect(pp.count("captureAuthorization")).toBe(0);
    expect(await state()).toBe("REPORT_READY");
    expect((await live()).approvedBy).toBeNull();
  });

  it("a double click records one approval and one capture", async () => {
    const [a, b] = await Promise.all([approve(), approve()]);
    expect([a, b].filter((r) => r.ok)).not.toHaveLength(0);
    expect(await state()).toBe("RELEASED");
    expect(pp.captures.size).toBe(1);
    const actions = await auditActions(db(), f.projectId);
    expect(actions.filter((x) => x === "release_approved")).toHaveLength(1);
    expect(actions.filter((x) => x === "capture_completed")).toHaveLength(1);
  });

  it("a capture that times out stays APPROVED; the retry sends the same request id and captures once", async () => {
    pp.failNext("captureAuthorization", new Error("network timeout"));
    expect(await approve()).toEqual({ ok: false, error: "paypal_unavailable" });
    expect(await state()).toBe("APPROVED");
    expect(await approve()).toEqual({ ok: true, value: { state: "RELEASED" } });
    const rids = pp.calls.filter((c) => c.op === "captureAuthorization").map((c) => c.requestId);
    expect(rids).toHaveLength(2);
    expect(new Set(rids).size).toBe(1);
    expect(pp.captures.size).toBe(1);
  });

  it("an override is stored and audited, and a retry from APPROVED reuses the stored reason", async () => {
    pp.failNext("captureAuthorization", new PaypalApiError(503, "SERVICE_UNAVAILABLE"));
    expect(await approve({ latestVerdicts: oneFail, overrideReason: REASON })).toEqual({ ok: false, error: "paypal_unavailable" });
    expect(await live()).toMatchObject({ overrideReason: REASON });
    expect(await auditActions(db(), f.projectId)).toContain("override_recorded");
    expect(await approve({ latestVerdicts: oneFail })).toEqual({ ok: true, value: { state: "RELEASED" } });
  });

  it("a capture whose amount differs from the payment does not release", async () => {
    pp.setNextCaptureAmount(4000);
    expect(await approve()).toEqual({ ok: false, error: "amount_mismatch" });
    expect(await state()).toBe("APPROVED");
  });

  it("a 4xx capture refusal is reported and leaves the milestone APPROVED", async () => {
    pp.failNext("captureAuthorization", new PaypalApiError(422, "AUTHORIZATION_EXPIRED"));
    expect(await approve()).toEqual({ ok: false, error: "paypal_refused" });
    expect(await state()).toBe("APPROVED");
  });
});

describe("reconcileCapture", () => {
  it("reads the capture back: PENDING -> COMPLETED releases, and a repeat does nothing", async () => {
    pp.setNextCaptureStatus("PENDING", "PENDING_REVIEW");
    await approve();
    const p = await live();
    expect(await reconcileCapture(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "CAPTURE_PENDING" } });
    pp.setCaptureStatus(p.captureId!, "COMPLETED");
    expect(await reconcileCapture(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect(await reconcileCapture(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect((await auditActions(db(), f.projectId)).filter((x) => x === "capture_completed")).toHaveLength(1);
  });

  it("a pending capture that PayPal declines goes back to APPROVED via capture_denied", async () => {
    pp.setNextCaptureStatus("PENDING");
    await approve();
    const p = await live();
    pp.setCaptureStatus(p.captureId!, "DECLINED");
    expect(await reconcileCapture(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "APPROVED" } });
    expect(await live()).toMatchObject({ captureStatus: "DECLINED", status: "capture_denied" });
  });
});

describe("sendPayout and reconcilePayout", () => {
  it("pays the stored payout amount to the snapshotted payee, then SUCCESS moves to PAID", async () => {
    await approve();
    const p = await live();
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "PAID" } });
    const b = [...pp.batches.values()][0]!;
    expect(b).toMatchObject({ receiver: FREELANCER_EMAIL, amountCents: 4650, senderBatchId: `arbiter-${p.id}` });
    const after = await live();
    expect(after).toMatchObject({ payoutBatchId: b.batchId, payoutItemId: b.items[0]!.itemId, payoutStatus: "SUCCESS", status: "paid" });
    expect(pp.calls.find((c) => c.op === "createPayout")?.requestId).toBe((after.requestIds as Record<string, string>).payout);
    expect(await auditActions(db(), f.projectId)).toEqual(expect.arrayContaining(["payout_sent", "payout_succeeded"]));
  });

  it("never starts a payout unless the capture read back from PayPal is COMPLETED", async () => {
    await approve();
    const p = await live();
    pp.setCaptureStatus(p.captureId!, "PENDING");
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "capture_not_completed" });
    expect(pp.count("createPayout")).toBe(0);
  });

  it("refuses a payout when the milestone is not RELEASED", async () => {
    pp.setNextCaptureStatus("PENDING");
    await approve();
    expect(await sendPayout(db(), pp.api, (await live()).id)).toEqual({ ok: false, error: "not_releasable" });
    expect(pp.count("createPayout")).toBe(0);
  });

  it("a repeated or concurrent payout sends one batch", async () => {
    pp.setNextPayoutItemStatus("PENDING");
    await approve();
    const p = await live();
    await Promise.all([sendPayout(db(), pp.api, p.id), sendPayout(db(), pp.api, p.id)]);
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect(pp.batches.size).toBe(1);
    expect((await auditActions(db(), f.projectId)).filter((x) => x === "payout_sent")).toHaveLength(1);
    pp.setPayoutItemStatus([...pp.batches.keys()][0]!, "SUCCESS");
    expect(await reconcilePayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "PAID" } });
    expect(await reconcilePayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "PAID" } });
    expect((await auditActions(db(), f.projectId)).filter((x) => x === "payout_succeeded")).toHaveLength(1);
  });

  it("a FAILED payout item stays RELEASED, is audited once, and is not retried automatically", async () => {
    pp.setNextPayoutItemStatus("FAILED");
    await approve();
    const p = await live();
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect(await reconcilePayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect(await live()).toMatchObject({ status: "payout_failed", payoutStatus: "FAILED" });
    expect((await auditActions(db(), f.projectId)).filter((x) => x === "payout_failed")).toHaveLength(1);
    expect(pp.count("createPayout")).toBe(1);
  });

  it("a 429 or 409 on create-payout is temporary: nothing is marked failed and the retry pays once", async () => {
    await approve();
    const p = await live();
    for (const status of [429, 409]) {
      pp.failNext("createPayout", new PaypalApiError(status, "RATE_LIMIT_REACHED"));
      expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "paypal_unavailable" });
      expect((await live()).status).not.toBe("payout_failed");
    }
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "PAID" } });
    expect(pp.batches.size).toBe(1);
    expect(await auditActions(db(), f.projectId)).not.toContain("payout_failed");
  });

  it("review I1: a 401 on create-payout (stale token) is temporary, not a permanent failure", async () => {
    await approve();
    const p = await live();
    pp.failNext("createPayout", new PaypalApiError(401, "AUTHENTICATION_FAILURE"));
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "paypal_unavailable" });
    expect((await live()).status).not.toBe("payout_failed");
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "PAID" } });
    expect(pp.batches.size).toBe(1);
  });

  it("a duplicate-batch answer means PayPal may already have paid: flagged for a human, not 'failed'", async () => {
    await approve();
    const p = await live();
    pp.failNext("createPayout", new PaypalApiError(400, "DUPLICATE_REQUEST_ID"));
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "payout_unknown" });
    expect(await live()).toMatchObject({ status: "payout_unknown" });
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "payout_unknown" });
    expect(pp.count("createPayout")).toBe(1);
    expect(await auditActions(db(), f.projectId)).not.toContain("payout_failed");
  });

  it("a permanent 4xx (bad receiver) marks the payout failed once", async () => {
    await approve();
    const p = await live();
    pp.failNext("createPayout", new PaypalApiError(422, "RECEIVER_UNREGISTERED"));
    expect(await sendPayout(db(), pp.api, p.id)).toEqual({ ok: false, error: "paypal_refused" });
    expect(await live()).toMatchObject({ status: "payout_failed" });
    expect((await auditActions(db(), f.projectId)).filter((x) => x === "payout_failed")).toHaveLength(1);
  });

  it("a batch read back without items is not PAID, even if the batch says SUCCESS", async () => {
    pp.setNextPayoutItemStatus("PENDING");
    await approve();
    const p = await live();
    await sendPayout(db(), pp.api, p.id);
    pp.setPayoutBatchOnly([...pp.batches.keys()][0]!, "SUCCESS");
    expect(await reconcilePayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect((await live()).status).toBe("payout_pending");
  });

  it("a DENIED or CANCELED batch with no items is a failed payout", async () => {
    pp.setNextPayoutItemStatus("PENDING");
    await approve();
    const p = await live();
    await sendPayout(db(), pp.api, p.id);
    pp.setPayoutBatchOnly([...pp.batches.keys()][0]!, "DENIED");
    expect(await reconcilePayout(db(), pp.api, p.id)).toEqual({ ok: true, value: { state: "RELEASED" } });
    expect(await live()).toMatchObject({ status: "payout_failed", payoutStatus: "DENIED" });
  });

  it("refuses a payout after the payee email changed", async () => {
    await approve();
    await db().update(s.users).set({ paypalEmail: "other@example.test" }).where(eq(s.users.id, f.freelancer));
    expect(await sendPayout(db(), pp.api, (await live()).id)).toEqual({ ok: false, error: "payee_changed" });
    expect(pp.count("createPayout")).toBe(0);
  });
});
