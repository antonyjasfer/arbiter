import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { ensureRequestId } from "./request-ids";
import { lockedProject } from "./test-fixtures";

const db = setupTestDb();
let paymentId: string;

beforeEach(async () => {
  const f = await lockedProject(db());
  const [p] = await db().insert(s.payments).values({ milestoneId: f.milestoneIds[0]!, status: "order_pending", amount: "50.00" }).returning();
  paymentId = p!.id;
});

describe("ensureRequestId", () => {
  it("allocates a uuid per action, stores it on the payment, and returns the stored one again", async () => {
    const a = await ensureRequestId(db(), paymentId, "capture");
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await ensureRequestId(db(), paymentId, "capture")).toBe(a);
    const b = await ensureRequestId(db(), paymentId, "payout");
    expect(b).not.toBe(a);
    const [row] = await db().select({ ids: s.payments.requestIds }).from(s.payments).where(eq(s.payments.id, paymentId));
    expect(row!.ids).toEqual({ capture: a, payout: b });
  });

  it("gives racing callers the same id", async () => {
    const ids = await Promise.all([1, 2, 3, 4].map(() => ensureRequestId(db(), paymentId, "authorize")));
    expect(new Set(ids).size).toBe(1);
  });

  it("does not bump the payment's state_version", async () => {
    await ensureRequestId(db(), paymentId, "void");
    const [row] = await db().select({ v: s.payments.stateVersion }).from(s.payments).where(eq(s.payments.id, paymentId));
    expect(row!.v).toBe(0);
  });
});
