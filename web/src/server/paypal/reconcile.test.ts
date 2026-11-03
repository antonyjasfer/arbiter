import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { reconcileEvent, resourcePathFor, statusOf } from "./reconcile";
import { recordEvent } from "./webhook-store";

const db = setupTestDb();

async function stored(resourceType: string, resourceId: string, eventId = "WH-" + resourceType + resourceId) {
  const { id } = await recordEvent(db(), { paypalEventId: eventId, eventType: "X", resourceType, resourceId, payloadSha256: "b".repeat(64) });
  return { id, resourceType, resourceId };
}
const row = async (id: string) => (await db().select().from(s.webhookEvents).where(eq(s.webhookEvents.id, id)))[0]!;

describe("resourcePathFor", () => {
  it("maps each PayPal resource type to its read-only GET path", () => {
    expect(resourcePathFor("capture", "C1")).toBe("/v2/payments/captures/C1");
    expect(resourcePathFor("authorization", "A1")).toBe("/v2/payments/authorizations/A1");
    expect(resourcePathFor("checkout-order", "O1")).toBe("/v2/checkout/orders/O1");
    expect(resourcePathFor("payouts", "B1")).toBe("/v1/payments/payouts/B1");
    expect(resourcePathFor("payouts_item", "I1")).toBe("/v1/payments/payouts-item/I1");
    expect(resourcePathFor("dispute", "D1")).toBeNull();
  });

  it("refuses ids that could change the path", () => {
    expect(resourcePathFor("capture", "../orders/X")).toBeNull();
    expect(resourcePathFor("capture", "C1?x=1")).toBeNull();
  });
});

describe("statusOf", () => {
  it("reads status, batch_status or transaction_status depending on the resource", () => {
    expect(statusOf("capture", { status: "COMPLETED" })).toBe("COMPLETED");
    expect(statusOf("payouts", { batch_header: { batch_status: "SUCCESS" } })).toBe("SUCCESS");
    expect(statusOf("payouts_item", { transaction_status: "SUCCESS" })).toBe("SUCCESS");
    expect(statusOf("capture", { nothing: true })).toBe("unknown");
  });
});

describe("reconcileEvent", () => {
  it("stores the status fetched from PayPal", async () => {
    const e = await stored("capture", "C1");
    const paths: string[] = [];
    await reconcileEvent(db(), e, async (p) => {
      paths.push(p);
      return { status: "PENDING" };
    });
    expect(paths).toEqual(["/v2/payments/captures/C1"]);
    const r = await row(e.id);
    expect(r.reconciledStatus).toBe("PENDING");
    expect(r.reconciledAt).toBeInstanceOf(Date);
  });

  it("stores unsupported for unknown resource types without calling PayPal", async () => {
    const e = await stored("dispute", "D1");
    let called = false;
    await reconcileEvent(db(), e, async () => {
      called = true;
      return {};
    });
    expect(called).toBe(false);
    expect((await row(e.id)).reconciledStatus).toBe("unsupported");
  });

  it("stores error when the fetch fails", async () => {
    const e = await stored("capture", "C2");
    await reconcileEvent(db(), e, async () => {
      throw new Error("PayPal 503");
    });
    expect((await row(e.id)).reconciledStatus).toBe("error");
  });

  it("does not depend on event order: each event stores what PayPal says now", async () => {
    const later = await stored("capture", "C3", "WH-later");
    const earlier = await stored("capture", "C3", "WH-earlier");
    const fetcher = async () => ({ status: "COMPLETED" });
    await reconcileEvent(db(), later, fetcher);
    await reconcileEvent(db(), earlier, fetcher);
    expect((await row(later.id)).reconciledStatus).toBe("COMPLETED");
    expect((await row(earlier.id)).reconciledStatus).toBe("COMPLETED");
  });
});
