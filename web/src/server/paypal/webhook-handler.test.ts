import { describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { handlePaypalWebhook, type WebhookDeps } from "./webhook-handler";

const db = setupTestDb();

const HEADERS = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "c2ln",
  "paypal-transmission-time": "2026-11-03T00:00:00Z",
};
const BODY = JSON.stringify({ id: "WH-9", event_type: "PAYMENT.CAPTURE.PENDING", resource_type: "capture", resource: { id: "C9" } });
const req = (headers: Record<string, string> = HEADERS, body = BODY) => new Request("https://x/api/webhooks/paypal", { method: "POST", headers, body });

function deps(over: Partial<WebhookDeps> = {}) {
  const calls = { verify: [] as string[], fetch: [] as string[] };
  const d: WebhookDeps = {
    db: db(),
    webhookId: "WEBHOOK-1",
    verify: async (b) => {
      calls.verify.push(b);
      return "SUCCESS";
    },
    fetchResource: async (p) => {
      calls.fetch.push(p);
      return { status: "PENDING" };
    },
    log: () => {},
    ...over,
  };
  return { d, calls };
}

describe("handlePaypalWebhook", () => {
  it("answers 503 and stores nothing when no webhook id is configured", async () => {
    const { d, calls } = deps({ webhookId: undefined });
    expect((await handlePaypalWebhook(req(), d)).status).toBe(503);
    expect(calls.verify).toEqual([]);
    expect(await db().select().from(s.webhookEvents)).toHaveLength(0);
  });

  it("answers 400 when PayPal headers are missing", async () => {
    const { d, calls } = deps();
    expect((await handlePaypalWebhook(req({ "content-type": "application/json" }), d)).status).toBe(400);
    expect(calls.verify).toEqual([]);
  });

  it("answers 400 and stores nothing when PayPal says the signature is not valid", async () => {
    const { d } = deps({ verify: async () => "FAILURE" });
    expect((await handlePaypalWebhook(req(), d)).status).toBe(400);
    expect(await db().select().from(s.webhookEvents)).toHaveLength(0);
  });

  it("verifies the raw body, stores a new event, reconciles it and answers 200", async () => {
    const { d, calls } = deps();
    const res = await handlePaypalWebhook(req(), d);
    expect(res.status).toBe(200);
    expect(calls.verify[0]).toContain(`"webhook_event":${BODY}`);
    expect(calls.verify[0]).toContain(`"webhook_id":"WEBHOOK-1"`);
    expect(calls.fetch).toEqual(["/v2/payments/captures/C9"]);
    const rows = await db().select().from(s.webhookEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paypalEventId: "WH-9", resourceId: "C9", verified: true, reconciledStatus: "PENDING" });
    expect(rows[0]!.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 200 to a duplicate delivery without reconciling again", async () => {
    const { d, calls } = deps();
    await handlePaypalWebhook(req(), d);
    const second = await handlePaypalWebhook(req(), d);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(calls.fetch).toHaveLength(1);
    expect(await db().select().from(s.webhookEvents)).toHaveLength(1);
  });

  it("answers 500 when the verify call itself fails, so PayPal retries", async () => {
    const { d } = deps({
      verify: async () => {
        throw new Error("PayPal 503");
      },
    });
    expect((await handlePaypalWebhook(req(), d)).status).toBe(500);
  });

  it("re-reconciles a duplicate delivery whose earlier reconcile failed (review finding 1)", async () => {
    let fail = true;
    const { d, calls } = deps({
      fetchResource: async (p) => {
        calls.fetch.push(p);
        if (fail) throw new Error("PayPal 503");
        return { status: "PENDING" };
      },
    });
    await handlePaypalWebhook(req(), d);
    expect((await db().select().from(s.webhookEvents))[0]!.reconciledStatus).toBe("error");
    fail = false;
    const again = await handlePaypalWebhook(req(), d);
    expect(again.status).toBe(200);
    expect(calls.fetch).toHaveLength(2);
    expect((await db().select().from(s.webhookEvents))[0]!.reconciledStatus).toBe("PENDING");
  });

  it("re-reconciles a duplicate whose status was never written", async () => {
    const { d, calls } = deps();
    await db().insert(s.webhookEvents).values({ paypalEventId: "WH-9", eventType: "PAYMENT.CAPTURE.PENDING", resourceType: "capture", resourceId: "C9", verified: true, payloadSha256: "c".repeat(64) });
    expect((await handlePaypalWebhook(req(), d)).status).toBe(200);
    expect(calls.fetch).toEqual(["/v2/payments/captures/C9"]);
    expect((await db().select().from(s.webhookEvents))[0]!.reconciledStatus).toBe("PENDING");
  });

  describe("payment reconcile (Phase 5)", () => {
    function withPayments(outcome: () => Promise<{ outcome: string }>) {
      const seen: { resourceType: string; resourceId: string }[] = [];
      const logs: string[] = [];
      const { d } = deps({
        reconcilePayment: async (r) => {
          seen.push(r);
          return outcome();
        },
        log: (l) => logs.push(l),
      });
      return { d, seen, logs };
    }

    it("hands the verified event's resource to the payment reconcile, on new and duplicate deliveries", async () => {
      const { d, seen } = withPayments(async () => ({ outcome: "reconciled" }));
      expect((await handlePaypalWebhook(req(), d)).status).toBe(200);
      expect((await handlePaypalWebhook(req(), d)).status).toBe(200);
      expect(seen).toEqual([
        { resourceType: "capture", resourceId: "C9" },
        { resourceType: "capture", resourceId: "C9" },
      ]);
    });

    it("never runs it for an unverified event", async () => {
      const { d, seen } = withPayments(async () => ({ outcome: "reconciled" }));
      expect((await handlePaypalWebhook(req(), { ...d, verify: async () => "FAILURE" })).status).toBe(400);
      expect(seen).toEqual([]);
    });

    it("answers 500 when PayPal couldn't be read, so PayPal redelivers", async () => {
      const { d } = withPayments(async () => ({ outcome: "retry" }));
      expect((await handlePaypalWebhook(req(), d)).status).toBe(500);
    });

    it("logs a refusal and answers 200 (a redelivery wouldn't change it; the page poll is the backstop)", async () => {
      const { d, logs } = withPayments(async () => {
        throw new Error("payment reconcile refused: amount_mismatch");
      });
      expect((await handlePaypalWebhook(req(), d)).status).toBe(200);
      expect(logs.some((l) => l.includes("payment=error") && l.includes("amount_mismatch"))).toBe(true);
    });
  });

  it("answers 200 to a verified event it cannot use, so PayPal does not retry it for days (review finding 2)", async () => {
    const { d } = deps();
    const body = JSON.stringify({ id: "WH-D1", event_type: "CUSTOMER.DISPUTE.CREATED", resource_type: "dispute", resource: { dispute_id: "PP-D-1" } });
    const res = await handlePaypalWebhook(req(HEADERS, body), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(await db().select().from(s.webhookEvents)).toHaveLength(0);
  });
});
