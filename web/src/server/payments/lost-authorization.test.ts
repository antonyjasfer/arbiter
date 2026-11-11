import { beforeEach, describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import { createFakePaypal } from "./fake-paypal";
import { cancelFunding, completeFunding, startFunding } from "./funding";
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
});

const live = async () => (await paymentRows(db(), m1)).find((p) => !p.supersededAt);
const poll = async () => reconcilePayment(db(), pp.api, { userId: f.client, paymentId: (await live())!.id, now: later(31) });

describe("cancelFunding (FUNDED -> CANCELLED)", () => {
  it("voids the authorization with a stored request id, cancels the milestone and audits it", async () => {
    expect(await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: true, value: { state: "CANCELLED" } });
    const p = (await paymentRows(db(), m1))[0]!;
    expect(p).toMatchObject({ status: "voided", authorizationStatus: "VOIDED" });
    expect(p.voidedAt).toBeInstanceOf(Date);
    expect(pp.authorizations.get(p.authorizationId!)!.status).toBe("VOIDED");
    expect(pp.calls.find((c) => c.op === "voidAuthorization")?.requestId).toBe((p.requestIds as Record<string, string>).void);
    expect((await milestoneRow(db(), m1)).state).toBe("CANCELLED");
    expect(await auditActions(db(), f.projectId)).toContain("funding_voided");
  });

  it("only the client may cancel, and only while FUNDED; refused before any PayPal call", async () => {
    expect(await cancelFunding(db(), pp.api, { userId: f.freelancer, milestoneId: m1 })).toMatchObject({ ok: false });
    await toReportReady(db(), m1);
    expect(await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "not_cancellable" });
    expect(pp.count("voidAuthorization")).toBe(0);
  });

  it("a replay after the void went through (PayPal: PREVIOUSLY_VOIDED) still finishes, once", async () => {
    const authId = (await live())!.authorizationId!;
    pp.setAuthorizationStatus(authId, "VOIDED");
    expect(await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: true, value: { state: "CANCELLED" } });
    expect(await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: true, value: { state: "CANCELLED" } });
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "funding_voided")).toHaveLength(1);
  });

  it("PayPal down: nothing changes and the client can try again", async () => {
    pp.failNext("voidAuthorization", new PaypalApiError(503, "SERVICE_UNAVAILABLE"));
    expect(await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "paypal_unavailable" });
    expect((await milestoneRow(db(), m1)).state).toBe("FUNDED");
  });
});

describe("lost authorization (read back VOIDED or EXPIRED)", () => {
  it.each(["EXPIRED", "VOIDED"])("FUNDED: %s moves the milestone back to AGREED and audits authorization_lost", async (status) => {
    pp.setAuthorizationStatus((await live())!.authorizationId!, status);
    expect(await poll()).toMatchObject({ ok: true, value: { state: "AGREED", paymentStatus: "authorization_lost" } });
    expect(await live()).toMatchObject({ status: "authorization_lost", authorizationStatus: status });
    expect(await auditActions(db(), f.projectId)).toContain("authorization_lost");
  });

  it("after work started (REPORT_READY): state kept, payment marked lost, approval refused with refund_needed", async () => {
    await toReportReady(db(), m1);
    pp.setAuthorizationStatus((await live())!.authorizationId!, "EXPIRED");
    expect(await poll()).toMatchObject({ ok: true, value: { state: "REPORT_READY", paymentStatus: "authorization_lost" } });
    expect(await approveRelease(db(), pp.api, { userId: f.client, milestoneId: m1, latestVerdicts: allPass })).toEqual({ ok: false, error: "refund_needed" });
    expect(pp.count("captureAuthorization")).toBe(0);
  });

  it("an authorization webhook triggers the same read-back; duplicates audit once", async () => {
    const authId = (await live())!.authorizationId!;
    pp.setAuthorizationStatus(authId, "VOIDED");
    expect(await reconcileWebhookResource(db(), pp.api, { resourceType: "authorization", resourceId: authId })).toEqual({ outcome: "reconciled", state: "AGREED" });
    expect(await reconcileWebhookResource(db(), pp.api, { resourceType: "authorization", resourceId: authId })).toEqual({ outcome: "reconciled", state: "AGREED" });
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "authorization_lost")).toHaveLength(1);
  });

  it("a live authorization (CREATED) changes nothing", async () => {
    expect(await poll()).toMatchObject({ ok: true, value: { state: "FUNDED", paymentStatus: "authorized" } });
  });

  it("a cancelled milestone's VOIDED authorization is not a loss", async () => {
    await cancelFunding(db(), pp.api, { userId: f.client, milestoneId: m1 });
    const authId = (await paymentRows(db(), m1))[0]!.authorizationId!;
    expect(await reconcileWebhookResource(db(), pp.api, { resourceType: "authorization", resourceId: authId })).toEqual({ outcome: "reconciled", state: "CANCELLED" });
    expect(await auditActions(db(), f.projectId)).not.toContain("authorization_lost");
  });

  it("re-funding after a loss in FUNDED creates a new payment row and supersedes the old one", async () => {
    const old = (await live())!;
    pp.setAuthorizationStatus(old.authorizationId!, "EXPIRED");
    await poll();
    const start = await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 });
    if (!start.ok) throw new Error(start.error);
    pp.approve(start.value.orderId);
    expect(await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId: start.value.orderId })).toEqual({ ok: true, value: { state: "FUNDED" } });
    const rows = await paymentRows(db(), m1);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === old.id)!.supersededAt).toBeInstanceOf(Date);
    expect(await live()).toMatchObject({ status: "authorized" });
    expect((await live())!.id).not.toBe(old.id);
  });
});
