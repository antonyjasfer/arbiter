import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { createFakePaypal } from "./fake-paypal";
import type { LatestVerdicts } from "./guard";
import { reconcilePayment } from "./reconcile";
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
