// Typed, Zod-validated wrappers for the PayPal calls Phase 5 makes. Money-moving calls (create order,
// authorize, capture, void, reauthorize, payouts) live only in server/payments (CLAUDE.md rule 1).
// The transport is injected: the app passes the sandbox-only client from server/paypal/client.ts, tests a fake.
// Sources: PayPal Orders v2 (create, show, authorize), Payments v2 and Payouts v1 REST references
// (developer.paypal.com/docs/api); request and response shapes match the live sandbox runs in spikes/01-paypal.ts.
import { z } from "zod";
import { centsToMoney, moneyToCents } from "../projects/money";

export type PaypalHttp = {
  /** POST to a sandbox path with a PayPal-Request-Id. Never throws on 4xx/5xx; returns the status and JSON body. */
  post(path: string, body: unknown, opts: { requestId: string }): Promise<{ status: number; body: unknown }>;
  get(path: string): Promise<{ status: number; body: unknown }>;
};

export class PaypalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly issue: string,
  ) {
    super(`PayPal answered HTTP ${status} (${issue})`);
    this.name = "PaypalApiError";
  }
}

export type PaypalOrder = { id: string; status: string };
export type PaypalAuthorization = { id: string; status: string; amountCents: number; currency: string; createTime: Date | null; expirationTime: Date | null };
export type PaypalCapture = { id: string; status: string; statusReason: string | null; amountCents: number | null; currency: string | null };
export type PaypalPayoutBatch = { batchId: string; batchStatus: string; items: { itemId: string; status: string | null }[] };

const PAYPAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const money = z.object({ currency_code: z.string(), value: z.string() });
const orderSchema = z.object({ id: z.string().regex(PAYPAL_ID), status: z.string() });
const authorizationSchema = z.object({
  id: z.string().regex(PAYPAL_ID),
  status: z.string(),
  amount: money,
  create_time: z.string().optional(),
  expiration_time: z.string().optional(),
});
const authorizeResponseSchema = orderSchema.extend({
  purchase_units: z.array(z.object({ payments: z.object({ authorizations: z.array(authorizationSchema).optional() }).optional() })).optional(),
});
// Capture statuses (Payments v2 schema): COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED.
const captureSchema = z.object({
  id: z.string().regex(PAYPAL_ID),
  status: z.string(),
  status_details: z.object({ reason: z.string().optional() }).optional(),
  amount: money.optional(),
});
// Payouts v1: the POST 201 holds only batch_header and links; items come from the GET.
const payoutHeaderSchema = z.object({ batch_header: z.object({ payout_batch_id: z.string().regex(PAYPAL_ID), batch_status: z.string() }) });
const payoutBatchSchema = payoutHeaderSchema.extend({
  items: z.array(z.object({ payout_item_id: z.string().regex(PAYPAL_ID), transaction_status: z.string().optional() })).optional(),
});
const errorSchema = z.object({ name: z.string().optional(), details: z.array(z.object({ issue: z.string().optional() })).optional() });

function checkId(id: string): string {
  if (!PAYPAL_ID.test(id)) throw new Error("PayPal id has an unexpected shape");
  return id;
}

function ensureOk(res: { status: number; body: unknown }): unknown {
  if (res.status >= 200 && res.status < 300) return res.body;
  const e = errorSchema.safeParse(res.body);
  const issue = (e.success && (e.data.details?.[0]?.issue ?? e.data.name)) || "UNKNOWN";
  throw new PaypalApiError(res.status, issue);
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(`PayPal ${what} response has an unexpected shape`);
  return r.data;
}

/** PayPal money ("50.00", "50.5" or "50") to integer cents. */
function paypalMoneyToCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw new Error("PayPal amount has an unexpected shape");
  return moneyToCents(`${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`);
}

const date = (s: string | undefined) => (s ? new Date(s) : null);

function toAuthorization(a: z.infer<typeof authorizationSchema>): PaypalAuthorization {
  return {
    id: a.id,
    status: a.status,
    amountCents: paypalMoneyToCents(a.amount.value),
    currency: a.amount.currency_code,
    createTime: date(a.create_time),
    expirationTime: date(a.expiration_time),
  };
}

export function createPaypalApi(http: PaypalHttp) {
  return {
    async createOrder(args: { amountCents: number; referenceId: string; customId: string; requestId: string }): Promise<PaypalOrder> {
      const body = {
        intent: "AUTHORIZE",
        purchase_units: [{ reference_id: args.referenceId, custom_id: args.customId, amount: { currency_code: "USD", value: centsToMoney(args.amountCents) } }],
        payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } } },
      };
      const res = await http.post("/v2/checkout/orders", body, { requestId: args.requestId });
      return parse(orderSchema, ensureOk(res), "create order");
    },

    async getOrder(orderId: string): Promise<PaypalOrder> {
      const res = await http.get(`/v2/checkout/orders/${checkId(orderId)}`);
      return parse(orderSchema, ensureOk(res), "order");
    },

    async authorizeOrder(orderId: string, requestId: string): Promise<PaypalAuthorization> {
      const res = await http.post(`/v2/checkout/orders/${checkId(orderId)}/authorize`, {}, { requestId });
      const order = parse(authorizeResponseSchema, ensureOk(res), "authorize");
      const a = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!a) throw new Error("PayPal authorize response has no authorization");
      return toAuthorization(a);
    },

    async getAuthorization(authorizationId: string): Promise<PaypalAuthorization> {
      const res = await http.get(`/v2/payments/authorizations/${checkId(authorizationId)}`);
      return toAuthorization(parse(authorizationSchema, ensureOk(res), "authorization"));
    },

    /** A final capture of the whole authorization. invoice_id ties it to our payment row. */
    async captureAuthorization(authorizationId: string, args: { amountCents: number; invoiceId: string; requestId: string }): Promise<PaypalCapture> {
      const path = `/v2/payments/authorizations/${checkId(authorizationId)}/capture`;
      const body = { amount: { currency_code: "USD", value: centsToMoney(args.amountCents) }, final_capture: true, invoice_id: args.invoiceId };
      return toCapture(parse(captureSchema, ensureOk(await http.post(path, body, { requestId: args.requestId })), "capture"));
    },

    async getCapture(captureId: string): Promise<PaypalCapture> {
      const res = await http.get(`/v2/payments/captures/${checkId(captureId)}`);
      return toCapture(parse(captureSchema, ensureOk(res), "capture"));
    },

    /**
     * One EMAIL payout. senderBatchId is deterministic per payment: PayPal rejects a sender_batch_id reused
     * within 30 days, so even a lost request id cannot pay twice. The request id is kept 30 days too.
     */
    async createPayout(args: { senderBatchId: string; receiver: string; amountCents: number; requestId: string; note: string }): Promise<{ batchId: string; batchStatus: string }> {
      const body = {
        sender_batch_header: { sender_batch_id: checkId(args.senderBatchId), email_subject: "You have a payout from Arbiter (sandbox)", email_message: args.note },
        items: [{ recipient_type: "EMAIL", receiver: args.receiver, amount: { value: centsToMoney(args.amountCents), currency: "USD" }, note: args.note, sender_item_id: args.senderBatchId }],
      };
      const h = parse(payoutHeaderSchema, ensureOk(await http.post("/v1/payments/payouts", body, { requestId: args.requestId })), "payout");
      return { batchId: h.batch_header.payout_batch_id, batchStatus: h.batch_header.batch_status };
    },

    async getPayoutBatch(batchId: string): Promise<PaypalPayoutBatch> {
      const b = parse(payoutBatchSchema, ensureOk(await http.get(`/v1/payments/payouts/${checkId(batchId)}`)), "payout batch");
      return {
        batchId: b.batch_header.payout_batch_id,
        batchStatus: b.batch_header.batch_status,
        items: (b.items ?? []).map((i) => ({ itemId: i.payout_item_id, status: i.transaction_status ?? null })),
      };
    },
  };
}

function toCapture(c: z.infer<typeof captureSchema>): PaypalCapture {
  return {
    id: c.id,
    status: c.status,
    statusReason: c.status_details?.reason ?? null,
    amountCents: c.amount ? paypalMoneyToCents(c.amount.value) : null,
    currency: c.amount?.currency_code ?? null,
  };
}

export type PaypalApi = ReturnType<typeof createPaypalApi>;
