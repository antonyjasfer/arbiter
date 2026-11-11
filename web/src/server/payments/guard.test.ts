import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { createFakePaypal } from "./fake-paypal";
import { checkPayout, checkRelease, recordOverride, type LatestVerdicts } from "./guard";
import { auditActions, FREELANCER_EMAIL, fundMilestone, lockedProject, paymentRows, toReportReady, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
const allPass: LatestVerdicts = async () => ["pass", "needs_review"];
const oneFail: LatestVerdicts = async () => ["pass", "fail"];
const REASON = "The failing check was a flaky network test; I reviewed the demo myself.";

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  const pp = createFakePaypal();
  await fundMilestone(db(), pp, f, m1);
  await toReportReady(db(), m1);
});

const check = (over: Partial<Parameters<typeof checkRelease>[1]> = {}) => checkRelease(db(), { userId: f.client, milestoneId: m1, latestVerdicts: allPass, ...over });

describe("checkRelease", () => {
  it("returns the release plan for the client of a funded, reported milestone with no FAIL", async () => {
    const r = await check();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ amountCents: 5000, feeCents: 350, payoutCents: 4650, payeeEmail: FREELANCER_EMAIL, overrideReason: null, hasFail: false });
    expect(r.value.payment.authorizationId).toBeTruthy();
  });

  it("refuses an approval by the freelancer, and hides the milestone from outsiders", async () => {
    expect(await check({ userId: f.freelancer })).toEqual({ ok: false, error: "forbidden" });
    expect(await check({ userId: f.outsider })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses when the freelancer's payee email changed after funding", async () => {
    await db().update(s.users).set({ paypalEmail: "someone.else@example.test" }).where(eq(s.users.id, f.freelancer));
    expect(await check()).toEqual({ ok: false, error: "payee_changed" });
  });

  it("refuses when the payment's amount is above the milestone amount", async () => {
    const [p] = await paymentRows(db(), m1);
    await db().update(s.payments).set({ amount: "60.00" }).where(eq(s.payments.id, p!.id));
    expect(await check()).toEqual({ ok: false, error: "amount_exceeds_milestone" });
  });

  it("refuses when the stored payout plus fee does not add up to the amount", async () => {
    const [p] = await paymentRows(db(), m1);
    await db().update(s.payments).set({ payoutAmount: "49.00" }).where(eq(s.payments.id, p!.id));
    expect(await check()).toEqual({ ok: false, error: "amount_exceeds_milestone" });
  });

  it("refuses a FAIL in the latest run without a written override", async () => {
    expect(await check({ latestVerdicts: oneFail })).toEqual({ ok: false, error: "fail_without_override" });
  });

  it("requires an override of at least 20 characters", async () => {
    expect(await check({ latestVerdicts: oneFail, overrideReason: "   looks fine to me   " })).toEqual({ ok: false, error: "override_too_short" });
    const r = await check({ latestVerdicts: oneFail, overrideReason: `  ${REASON}  ` });
    expect(r.ok && r.value).toMatchObject({ hasFail: true, overrideReason: REASON });
  });

  it("refuses when there is no verification report", async () => {
    expect(await check({ latestVerdicts: async () => null })).toEqual({ ok: false, error: "no_report" });
  });

  it("refuses a milestone that is not waiting for approval", async () => {
    await db().update(s.milestones).set({ state: "FUNDED" }).where(eq(s.milestones.id, m1));
    expect(await check()).toEqual({ ok: false, error: "not_releasable" });
  });

  it("refuses when the authorization was lost (re-fund needed)", async () => {
    const [p] = await paymentRows(db(), m1);
    await db().update(s.payments).set({ status: "authorization_lost", authorizationStatus: "EXPIRED" }).where(eq(s.payments.id, p!.id));
    expect(await check()).toEqual({ ok: false, error: "refund_needed" });
  });

  it("refuses when there is no live authorized payment", async () => {
    await db().update(s.payments).set({ supersededAt: new Date() }).where(eq(s.payments.milestoneId, m1));
    expect(await check()).toEqual({ ok: false, error: "not_funded" });
  });
});

describe("recordOverride", () => {
  it("audits override_recorded with the reason", async () => {
    const [p] = await paymentRows(db(), m1);
    await db().transaction((tx) => recordOverride(tx, { projectId: f.projectId, userId: f.client, milestoneId: m1, paymentId: p!.id, reason: REASON }));
    expect(await auditActions(db(), f.projectId)).toContain("override_recorded");
    const [e] = await db().select({ data: s.auditEvents.data }).from(s.auditEvents).where(eq(s.auditEvents.action, "override_recorded"));
    expect(e!.data).toMatchObject({ milestoneId: m1, paymentId: p!.id, reason: REASON });
  });
});

describe("checkPayout", () => {
  async function released() {
    const [p] = await paymentRows(db(), m1);
    await db().update(s.milestones).set({ state: "RELEASED" }).where(eq(s.milestones.id, m1));
    await db().update(s.payments).set({ captureId: "CAP1", captureStatus: "COMPLETED", approvedBy: f.client, approvedAt: new Date() }).where(eq(s.payments.id, p!.id));
    return p!.id;
  }

  it("allows the payout once the read-back capture is COMPLETED", async () => {
    const paymentId = await released();
    const r = await checkPayout(db(), { paymentId, captureStatus: "COMPLETED" });
    expect(r.ok && r.value).toMatchObject({ payoutCents: 4650, payeeEmail: FREELANCER_EMAIL });
  });

  it("refuses a payout while the capture is PENDING", async () => {
    const paymentId = await released();
    expect(await checkPayout(db(), { paymentId, captureStatus: "PENDING" })).toEqual({ ok: false, error: "capture_not_completed" });
  });

  it("refuses a payout when the payee changed, the approver is not the client, or the milestone is not RELEASED", async () => {
    const paymentId = await released();
    await db().update(s.users).set({ paypalEmail: "x@example.test" }).where(eq(s.users.id, f.freelancer));
    expect(await checkPayout(db(), { paymentId, captureStatus: "COMPLETED" })).toEqual({ ok: false, error: "payee_changed" });
    await db().update(s.users).set({ paypalEmail: FREELANCER_EMAIL }).where(eq(s.users.id, f.freelancer));
    await db().update(s.payments).set({ approvedBy: f.freelancer }).where(eq(s.payments.id, paymentId));
    expect(await checkPayout(db(), { paymentId, captureStatus: "COMPLETED" })).toEqual({ ok: false, error: "approver_not_client" });
    await db().update(s.payments).set({ approvedBy: f.client }).where(eq(s.payments.id, paymentId));
    await db().update(s.milestones).set({ state: "CAPTURE_PENDING" }).where(eq(s.milestones.id, m1));
    expect(await checkPayout(db(), { paymentId, captureStatus: "COMPLETED" })).toEqual({ ok: false, error: "not_releasable" });
  });
});
