import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import { createFakePaypal } from "./fake-paypal";
import { completeFunding, startFunding } from "./funding";
import { auditActions, FREELANCER_EMAIL, lockedProject, milestoneRow, paymentRows, type Fixture } from "./test-fixtures";

const db = setupTestDb();
const DAY_MS = 86_400_000;
let f: Fixture;
let m1: string;
let pp: ReturnType<typeof createFakePaypal>;

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  pp = createFakePaypal();
});

async function fundedOrder() {
  const r = await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 });
  if (!r.ok) throw new Error(`startFunding: ${r.error}`);
  return r.value.orderId;
}

describe("startFunding", () => {
  it("creates an AUTHORIZE order for exactly the milestone amount with a stored request id", async () => {
    const r = await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 });
    expect(r.ok).toBe(true);
    const [p] = await paymentRows(db(), m1);
    expect(p).toMatchObject({ amount: "50.00", status: "order_pending", paypalOrderId: r.ok ? r.value.orderId : "", createdBy: f.client, supersededAt: null });
    const order = pp.orders.get(p!.paypalOrderId!);
    expect(order).toMatchObject({ amountCents: 5000, referenceId: m1, customId: p!.id });
    const create = pp.calls.find((c) => c.op === "createOrder");
    expect(create?.requestId).toBe((p!.requestIds as Record<string, string>).create_order);
    expect(await auditActions(db(), f.projectId)).toContain("funding_started");
  });

  it("snapshots the freelancer's PayPal email and the fee split on the payment, and keeps the email out of the audit", async () => {
    await fundedOrder();
    const [p] = await paymentRows(db(), m1);
    // 5000 cents: fee 5% + 100 = 350, payout 4650.
    expect(p).toMatchObject({ payeeEmail: FREELANCER_EMAIL, fee: "3.50", payoutAmount: "46.50" });
    const events = await db().select({ data: s.auditEvents.data }).from(s.auditEvents).where(eq(s.auditEvents.projectId, f.projectId));
    expect(JSON.stringify(events)).not.toContain(FREELANCER_EMAIL);
  });

  it("refuses when the freelancer has no PayPal email yet", async () => {
    await db().update(s.users).set({ paypalEmail: null }).where(eq(s.users.id, f.freelancer));
    expect(await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "payee_email_missing" });
    expect(pp.count("createOrder")).toBe(0);
  });

  it("lets only the project's client fund", async () => {
    expect(await startFunding(db(), pp.api, { userId: f.freelancer, milestoneId: m1 })).toEqual({ ok: false, error: "forbidden" });
    expect(await startFunding(db(), pp.api, { userId: f.outsider, milestoneId: m1 })).toEqual({ ok: false, error: "not_found" });
    expect(await startFunding(db(), pp.api, { userId: f.client, milestoneId: "not-a-uuid" })).toEqual({ ok: false, error: "not_found" });
    expect(pp.count("createOrder")).toBe(0);
  });

  it("refuses a milestone that is not AGREED", async () => {
    const m = await milestoneRow(db(), m1);
    await transitionMilestone(db(), { milestoneId: m1, expectedState: "AGREED", expectedVersion: m.stateVersion, event: "authorized" });
    expect(await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "not_agreed" });
    expect(pp.count("createOrder")).toBe(0);
  });

  it("refuses a milestone whose live payment is already authorized", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId });
    // Simulate the milestone being back in AGREED with the authorized payment still live (a crash window).
    await db().update(s.milestones).set({ state: "AGREED" }).where(eq(s.milestones.id, m1));
    expect(await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "already_funded" });
  });

  it("reuses the order of a live payment the buyer has not approved yet (cancelled popup)", async () => {
    const first = await fundedOrder();
    const second = await fundedOrder();
    expect(second).toBe(first);
    expect(await paymentRows(db(), m1)).toHaveLength(1);
    expect(pp.orders.size).toBe(1);
  });

  it("supersedes a live payment whose order PayPal no longer accepts, and starts a new one", async () => {
    const first = await fundedOrder();
    pp.orders.get(first)!.status = "VOIDED";
    const second = await fundedOrder();
    expect(second).not.toBe(first);
    const rows = await paymentRows(db(), m1);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.supersededAt === null).map((r) => r.paypalOrderId)).toEqual([second]);
  });

  it("replays the create call with the stored request id after a timeout", async () => {
    pp.failNext("createOrder", new Error("socket hang up"));
    expect(await startFunding(db(), pp.api, { userId: f.client, milestoneId: m1 })).toEqual({ ok: false, error: "paypal_unavailable" });
    const orderId = await fundedOrder();
    const rids = pp.calls.filter((c) => c.op === "createOrder").map((c) => c.requestId);
    expect(rids).toHaveLength(2);
    expect(rids[0]).toBe(rids[1]);
    expect(pp.orders.size).toBe(1);
    expect((await paymentRows(db(), m1))[0]!.paypalOrderId).toBe(orderId);
  });

  it("keeps one live payment and one order when two Fund clicks race", async () => {
    const [a, b] = await Promise.all([fundedOrder(), fundedOrder()]);
    expect(a).toBe(b);
    expect((await paymentRows(db(), m1)).filter((r) => r.supersededAt === null)).toHaveLength(1);
    expect(pp.orders.size).toBe(1);
  });
});

describe("completeFunding", () => {
  it("authorizes the approved order and moves AGREED to FUNDED, auditing funded", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    const r = await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId });
    expect(r).toEqual({ ok: true, value: { state: "FUNDED" } });
    const [p] = await paymentRows(db(), m1);
    const auth = [...pp.authorizations.values()][0]!;
    expect(p).toMatchObject({ status: "authorized", authorizationId: auth.id, authorizationStatus: "CREATED" });
    expect(p!.authorizationExpiresAt?.getTime()).toBe(auth.expirationTime!.getTime());
    expect(p!.honorPeriodEndsAt?.getTime()).toBe(auth.createTime!.getTime() + 3 * DAY_MS);
    expect(pp.calls.find((c) => c.op === "authorizeOrder")?.requestId).toBe((p!.requestIds as Record<string, string>).authorize);
    expect((await milestoneRow(db(), m1)).state).toBe("FUNDED");
    expect(await auditActions(db(), f.projectId)).toContain("funded");
  });

  it("records one authorization when the authorize is replayed", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    const args = { userId: f.client, milestoneId: m1, orderId };
    const results = await Promise.all([completeFunding(db(), pp.api, args), completeFunding(db(), pp.api, args)]);
    expect(await completeFunding(db(), pp.api, args)).toEqual({ ok: true, value: { state: "FUNDED" } });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(pp.authorizations.size).toBe(1);
    expect(new Set(pp.calls.filter((c) => c.op === "authorizeOrder").map((c) => c.requestId)).size).toBe(1);
    expect(await paymentRows(db(), m1)).toHaveLength(1);
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "funded")).toHaveLength(1);
  });

  it("retries an authorize that timed out with the same request id", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    pp.failNext("authorizeOrder", new Error("timeout"));
    const args = { userId: f.client, milestoneId: m1, orderId };
    expect(await completeFunding(db(), pp.api, args)).toEqual({ ok: false, error: "paypal_unavailable" });
    expect((await milestoneRow(db(), m1)).state).toBe("AGREED");
    expect(await completeFunding(db(), pp.api, args)).toEqual({ ok: true, value: { state: "FUNDED" } });
    expect(pp.authorizations.size).toBe(1);
  });

  it("leaves the milestone AGREED when the buyer cancelled (the order was never approved)", async () => {
    const orderId = await fundedOrder();
    expect(await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId })).toEqual({ ok: false, error: "order_not_approved" });
    expect((await milestoneRow(db(), m1)).state).toBe("AGREED");
    expect(await auditActions(db(), f.projectId)).not.toContain("funded");
  });

  it("refuses an order id that is not this milestone's live order, before calling PayPal", async () => {
    await fundedOrder();
    expect(await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId: "ORDERX" })).toEqual({ ok: false, error: "order_mismatch" });
    expect(pp.count("authorizeOrder")).toBe(0);
  });

  it("lets only the client complete funding", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    expect(await completeFunding(db(), pp.api, { userId: f.freelancer, milestoneId: m1, orderId })).toEqual({ ok: false, error: "forbidden" });
    expect(pp.count("authorizeOrder")).toBe(0);
  });

  it("does not fund when PayPal authorizes a different amount", async () => {
    const orderId = await fundedOrder();
    pp.approve(orderId);
    pp.orders.get(orderId)!.amountCents = 4000;
    expect(await completeFunding(db(), pp.api, { userId: f.client, milestoneId: m1, orderId })).toEqual({ ok: false, error: "amount_mismatch" });
    expect((await milestoneRow(db(), m1)).state).toBe("AGREED");
  });
});
