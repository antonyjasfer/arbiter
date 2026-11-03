import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "./webhook-event";

const ev = (resource_type: string, resource: object) => JSON.stringify({ id: "WH-1", event_type: "X.Y", resource_type, resource });

describe("parseWebhookEvent", () => {
  it("takes resource.id for captures, authorizations and orders", () => {
    for (const type of ["capture", "authorization", "checkout-order"]) {
      expect(parseWebhookEvent(ev(type, { id: "R1" }))).toEqual({ ok: true, value: { eventId: "WH-1", eventType: "X.Y", resourceType: type, resourceId: "R1" } });
    }
  });

  it("takes the batch id for payouts and the item id for payout items", () => {
    expect(parseWebhookEvent(ev("payouts", { batch_header: { payout_batch_id: "B1" } }))).toMatchObject({ ok: true, value: { resourceId: "B1" } });
    expect(parseWebhookEvent(ev("payouts_item", { payout_item_id: "I1" }))).toMatchObject({ ok: true, value: { resourceId: "I1" } });
  });

  it("rejects non-JSON and events without an id or resource id", () => {
    expect(parseWebhookEvent("not json")).toEqual({ ok: false, error: "invalid_event" });
    expect(parseWebhookEvent(JSON.stringify({ event_type: "X", resource_type: "capture", resource: { id: "R" } }))).toEqual({ ok: false, error: "invalid_event" });
    expect(parseWebhookEvent(ev("capture", {}))).toEqual({ ok: false, error: "invalid_event" });
  });
});
