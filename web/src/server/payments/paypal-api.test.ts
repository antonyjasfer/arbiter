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
