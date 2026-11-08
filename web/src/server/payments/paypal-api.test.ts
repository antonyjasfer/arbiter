import { describe, expect, it } from "vitest";
import { createPaypalApi, PaypalApiError, type PaypalHttp } from "./paypal-api";

type Call = { method: "GET" | "POST"; path: string; body?: unknown; requestId?: string };

function http(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const h: PaypalHttp = {
    post: async (path, body, opts) => {
      calls.push({ method: "POST", path, body, requestId: opts.requestId });
      return responses.shift() ?? { status: 500, body: {} };
    },
    get: async (path) => {
      calls.push({ method: "GET", path });
      return responses.shift() ?? { status: 500, body: {} };
    },
  };
  return { h, calls };
}

describe("createOrder", () => {
  it("posts an AUTHORIZE order for the exact amount in USD with the request id", async () => {
    const { h, calls } = http([{ status: 201, body: { id: "ORDER1", status: "PAYER_ACTION_REQUIRED" } }]);
    const order = await createPaypalApi(h).createOrder({ amountCents: 5000, referenceId: "m-1", customId: "p-1", requestId: "rid-1" });
    expect(order).toEqual({ id: "ORDER1", status: "PAYER_ACTION_REQUIRED" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/checkout/orders", requestId: "rid-1" });
    expect(calls[0]!.body).toMatchObject({
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: "m-1", custom_id: "p-1", amount: { currency_code: "USD", value: "50.00" } }],
    });
  });

  it("throws a PaypalApiError naming the issue on a non-2xx answer", async () => {
    const { h } = http([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AMOUNT_MISMATCH" }] } }]);
    const err = await createPaypalApi(h)
      .createOrder({ amountCents: 5000, referenceId: "m", customId: "p", requestId: "r" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaypalApiError);
    expect(err).toMatchObject({ status: 422, issue: "AMOUNT_MISMATCH" });
  });

  it("rejects a 2xx answer that does not match the expected shape", async () => {
    const { h } = http([{ status: 201, body: { status: "CREATED" } }]);
    await expect(createPaypalApi(h).createOrder({ amountCents: 5000, referenceId: "m", customId: "p", requestId: "r" })).rejects.toThrow(/shape/);
  });
});

describe("getOrder", () => {
  it("reads an order with a GET and refuses ids that are not PayPal-shaped", async () => {
    const { h, calls } = http([{ status: 200, body: { id: "ORDER1", status: "APPROVED" } }]);
    const api = createPaypalApi(h);
    expect(await api.getOrder("ORDER1")).toEqual({ id: "ORDER1", status: "APPROVED" });
    expect(calls[0]).toEqual({ method: "GET", path: "/v2/checkout/orders/ORDER1" });
    await expect(api.getOrder("../x")).rejects.toThrow(/id/);
  });
});

describe("authorizeOrder", () => {
  it("posts the authorize with the request id and returns the authorization", async () => {
    const auth = {
      id: "AUTH1",
      status: "CREATED",
      amount: { currency_code: "USD", value: "50.00" },
      create_time: "2026-11-05T10:00:00Z",
      expiration_time: "2026-12-04T10:00:00Z",
    };
    const { h, calls } = http([{ status: 201, body: { id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [auth] } }] } }]);
    const r = await createPaypalApi(h).authorizeOrder("ORDER1", "rid-a");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/checkout/orders/ORDER1/authorize", requestId: "rid-a" });
    expect(r).toEqual({
      id: "AUTH1",
      status: "CREATED",
      amountCents: 5000,
      currency: "USD",
      createTime: new Date("2026-11-05T10:00:00Z"),
      expirationTime: new Date("2026-12-04T10:00:00Z"),
    });
  });

  it("throws when the answer has no authorization", async () => {
    const { h } = http([{ status: 201, body: { id: "ORDER1", status: "COMPLETED", purchase_units: [{}] } }]);
    await expect(createPaypalApi(h).authorizeOrder("ORDER1", "r")).rejects.toThrow(/authorization/);
  });
});

describe("captureAuthorization", () => {
  it("posts a final capture of the exact amount with the request id and returns the capture", async () => {
    const body = { id: "CAP1", status: "PENDING", status_details: { reason: "PENDING_REVIEW" }, amount: { currency_code: "USD", value: "50.00" } };
    const { h, calls } = http([{ status: 201, body }]);
    const r = await createPaypalApi(h).captureAuthorization("AUTH1", { amountCents: 5000, invoiceId: "p-1", requestId: "rid-c" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/payments/authorizations/AUTH1/capture", requestId: "rid-c" });
    expect(calls[0]!.body).toEqual({ amount: { currency_code: "USD", value: "50.00" }, final_capture: true, invoice_id: "p-1" });
    expect(r).toEqual({ id: "CAP1", status: "PENDING", statusReason: "PENDING_REVIEW", amountCents: 5000, currency: "USD" });
  });

  it("refuses ids that are not PayPal-shaped", async () => {
    const { h, calls } = http([]);
    await expect(createPaypalApi(h).captureAuthorization("../x", { amountCents: 5000, invoiceId: "p", requestId: "r" })).rejects.toThrow(/id/);
    expect(calls).toHaveLength(0);
  });
});

describe("getCapture and getAuthorization", () => {
  it("read a capture and an authorization back with GETs", async () => {
    const { h, calls } = http([
      { status: 200, body: { id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "50.00" } } },
      { status: 200, body: { id: "AUTH1", status: "VOIDED", amount: { currency_code: "USD", value: "50.00" } } },
    ]);
    const api = createPaypalApi(h);
    expect(await api.getCapture("CAP1")).toEqual({ id: "CAP1", status: "COMPLETED", statusReason: null, amountCents: 5000, currency: "USD" });
    expect((await api.getAuthorization("AUTH1")).status).toBe("VOIDED");
    expect(calls.map((c) => c.path)).toEqual(["/v2/payments/captures/CAP1", "/v2/payments/authorizations/AUTH1"]);
  });
});

describe("createPayout", () => {
  it("posts one EMAIL item with the sender batch id and request id, and returns the batch header", async () => {
    const { h, calls } = http([{ status: 201, body: { batch_header: { payout_batch_id: "BATCH1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "arbiter-p-1" } }, links: [] } }]);
    const r = await createPaypalApi(h).createPayout({ senderBatchId: "arbiter-p-1", receiver: "f@example.test", amountCents: 4650, requestId: "rid-p", note: "Milestone 1" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/payments/payouts", requestId: "rid-p" });
    expect(calls[0]!.body).toMatchObject({
      sender_batch_header: { sender_batch_id: "arbiter-p-1" },
      items: [{ recipient_type: "EMAIL", receiver: "f@example.test", amount: { value: "46.50", currency: "USD" }, sender_item_id: "arbiter-p-1" }],
    });
    expect(r).toEqual({ batchId: "BATCH1", batchStatus: "PENDING" });
  });
});

describe("getPayoutBatch", () => {
  it("reads the batch and its items", async () => {
    const { h, calls } = http([
      {
        status: 200,
        body: { batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" }, items: [{ payout_item_id: "ITEM1", transaction_status: "SUCCESS", payout_batch_id: "BATCH1" }] },
      },
    ]);
    const r = await createPaypalApi(h).getPayoutBatch("BATCH1");
    expect(calls[0]).toEqual({ method: "GET", path: "/v1/payments/payouts/BATCH1" });
    expect(r).toEqual({ batchId: "BATCH1", batchStatus: "SUCCESS", items: [{ itemId: "ITEM1", status: "SUCCESS" }] });
  });
});

describe("getRefund", () => {
  it("reads a refund and finds its capture from the 'up' link", async () => {
    const { h, calls } = http([
      {
        status: 200,
        body: {
          id: "REF1",
          status: "COMPLETED",
          links: [
            { href: "https://api.sandbox.paypal.com/v2/payments/refunds/REF1", rel: "self", method: "GET" },
            { href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1", rel: "up", method: "GET" },
          ],
        },
      },
    ]);
    expect(await createPaypalApi(h).getRefund("REF1")).toEqual({ id: "REF1", status: "COMPLETED", captureId: "CAP1" });
    expect(calls[0]).toEqual({ method: "GET", path: "/v2/payments/refunds/REF1" });
  });

  it("returns a null capture id when no 'up' link names a capture", async () => {
    const { h } = http([{ status: 200, body: { id: "REF1", status: "COMPLETED", links: [{ href: "https://evil.example/v2/payments/captures/../x", rel: "up" }] } }]);
    expect((await createPaypalApi(h).getRefund("REF1")).captureId).toBeNull();
  });
});

describe("getPayoutItem", () => {
  it("reads a payout item and its batch id", async () => {
    const { h, calls } = http([{ status: 200, body: { payout_item_id: "ITEM1", transaction_status: "SUCCESS", payout_batch_id: "BATCH1" } }]);
    expect(await createPaypalApi(h).getPayoutItem("ITEM1")).toEqual({ itemId: "ITEM1", batchId: "BATCH1", status: "SUCCESS" });
    expect(calls[0]).toEqual({ method: "GET", path: "/v1/payments/payouts-item/ITEM1" });
  });
});

describe("voidAuthorization", () => {
  it("posts the void with the request id and accepts PayPal's 204 No Content", async () => {
    const { h, calls } = http([{ status: 204, body: null }]);
    await createPaypalApi(h).voidAuthorization("AUTH1", "rid-v");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v2/payments/authorizations/AUTH1/void", requestId: "rid-v" });
  });

  it("throws a PaypalApiError on a refusal", async () => {
    const { h } = http([{ status: 422, body: { details: [{ issue: "PREVIOUSLY_VOIDED" }] } }]);
    await expect(createPaypalApi(h).voidAuthorization("AUTH1", "rid-v")).rejects.toMatchObject({ status: 422, issue: "PREVIOUSLY_VOIDED" });
  });
});
