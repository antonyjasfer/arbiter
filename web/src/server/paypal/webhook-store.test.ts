import { describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { recordEvent } from "./webhook-store";

const db = setupTestDb();
const e = { paypalEventId: "WH-1", eventType: "PAYMENT.CAPTURE.PENDING", resourceType: "capture", resourceId: "C1", payloadSha256: "a".repeat(64) };

describe("recordEvent", () => {
  it("inserts a new event as verified", async () => {
    const r = await recordEvent(db(), e);
    expect(r.inserted).toBe(true);
    const rows = await db().select().from(s.webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.id, paypalEventId: "WH-1", verified: true, resourceId: "C1" });
  });

  it("returns the existing row for a repeated event id", async () => {
    const first = await recordEvent(db(), e);
    const again = await recordEvent(db(), e);
    expect(again).toEqual({ inserted: false, id: first.id, reconciledStatus: null });
    expect(await db().select().from(s.webhookEvents)).toHaveLength(1);
  });

  it("stores one row when the same event arrives twice at once (Review Focus 2)", async () => {
    const [a, b] = await Promise.all([recordEvent(db(), e), recordEvent(db(), e)]);
    expect([a.inserted, b.inserted].sort()).toEqual([false, true]);
    expect(a.id).toBe(b.id);
    expect(await db().select().from(s.webhookEvents)).toHaveLength(1);
  });
});
