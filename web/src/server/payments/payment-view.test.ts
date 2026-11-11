import { beforeEach, describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import { createFakePaypal } from "./fake-paypal";
import type { LatestVerdicts } from "./guard";
import { getPaymentView } from "./payment-view";
import { approveRelease } from "./release";
import { fundMilestone, lockedProject, milestoneRow, paymentRows, toReportReady, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
let pp: ReturnType<typeof createFakePaypal>;
const allPass: LatestVerdicts = async () => ["pass"];

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  pp = createFakePaypal();
  await fundMilestone(db(), pp, f, m1);
  await toReportReady(db(), m1);
});

const live = async () => (await paymentRows(db(), m1)).find((p) => !p.supersededAt)!;

describe("getPaymentView (the GET poll: read-only)", () => {
  it("reads the stored state for a member and makes no PayPal call or write, even when PayPal has moved on", async () => {
    pp.setNextCaptureStatus("PENDING", "PENDING_REVIEW");
    await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass });
    const before = await live();
    pp.setCaptureStatus(before.captureId!, "COMPLETED");
    const calls = pp.calls.length;

    const r = await getPaymentView(db(), { userId: f.freelancer, paymentId: before.id });

    expect(r).toEqual({ ok: true, value: { state: "CAPTURE_PENDING", paymentStatus: before.status, captureStatus: before.captureStatus, payoutStatus: null, lastError: null } });
    expect(pp.calls.length).toBe(calls);
    const after = await live();
    expect(after.stateVersion).toBe(before.stateVersion);
    expect(after.lastReconciledAt).toEqual(before.lastReconciledAt);
    expect((await milestoneRow(db(), m1)).state).toBe("CAPTURE_PENDING");
  });

  it("is not_found for a non-member, a malformed id, or an unknown payment id", async () => {
    const p = await live();
    expect(await getPaymentView(db(), { userId: f.outsider, paymentId: p.id })).toEqual({ ok: false, error: "not_found" });
    expect(await getPaymentView(db(), { userId: f.client, paymentId: "nope" })).toEqual({ ok: false, error: "not_found" });
    expect(await getPaymentView(db(), { userId: f.client, paymentId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "not_found" });
  });
});
