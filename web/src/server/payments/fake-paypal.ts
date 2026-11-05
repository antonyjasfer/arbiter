// Tests only: an in-memory PayPal that follows PayPal's idempotency rules strictly, so replay tests mean
// something. A request id that was seen before returns the original result; a second authorize of one
// order with a new request id is refused with 422 ORDER_ALREADY_AUTHORIZED, as PayPal does.
import { PaypalApiError, type PaypalApi, type PaypalAuthorization, type PaypalOrder } from "./paypal-api";

type Order = { id: string; status: string; amountCents: number; referenceId: string; customId: string };

const DAY_MS = 86_400_000;

export function createFakePaypal(opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${String(++seq).padStart(6, "0")}`;
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, PaypalAuthorization & { orderId: string }>();
  const byRequestId = new Map<string, unknown>();
  const calls: { op: string; requestId?: string; id?: string }[] = [];
  const failNext = new Map<string, Error>();

  function replay<T>(op: string, requestId: string, run: () => T): T {
    calls.push({ op, requestId });
    const injected = failNext.get(op);
    if (injected) {
      failNext.delete(op);
      throw injected;
    }
    const key = `${op}:${requestId}`;
    if (byRequestId.has(key)) return structuredClone(byRequestId.get(key)) as T;
    const result = run();
    byRequestId.set(key, structuredClone(result));
    return result;
  }

  const api: PaypalApi = {
    async createOrder(args) {
      return replay("createOrder", args.requestId, (): PaypalOrder => {
        const o: Order = { id: nextId("ORDER"), status: "PAYER_ACTION_REQUIRED", amountCents: args.amountCents, referenceId: args.referenceId, customId: args.customId };
        orders.set(o.id, o);
        return { id: o.id, status: o.status };
      });
    },
    async getOrder(orderId) {
      calls.push({ op: "getOrder", id: orderId });
      const o = orders.get(orderId);
      if (!o) throw new PaypalApiError(404, "RESOURCE_NOT_FOUND");
      return { id: o.id, status: o.status };
    },
    async authorizeOrder(orderId, requestId) {
      return replay("authorizeOrder", requestId, () => {
        const o = orders.get(orderId);
        if (!o) throw new PaypalApiError(404, "RESOURCE_NOT_FOUND");
        if (o.status === "COMPLETED") throw new PaypalApiError(422, "ORDER_ALREADY_AUTHORIZED");
        if (o.status !== "APPROVED") throw new PaypalApiError(422, "ORDER_NOT_APPROVED");
        o.status = "COMPLETED";
        const t = now();
        const out: PaypalAuthorization = { id: nextId("AUTH"), status: "CREATED", amountCents: o.amountCents, currency: "USD", createTime: t, expirationTime: new Date(t.getTime() + 29 * DAY_MS) };
        authorizations.set(out.id, { ...out, orderId });
        return out;
      });
    },
  };

  return {
    api,
    calls,
    orders,
    authorizations,
    /** The buyer approves the order in the PayPal popup. */
    approve(orderId: string) {
      const o = orders.get(orderId);
      if (!o) throw new Error("fake: no such order");
      o.status = "APPROVED";
    },
    /** The next call of `op` fails with `error` (for timeouts and outages). */
    failNext(op: string, error: Error) {
      failNext.set(op, error);
    },
    count: (op: string) => calls.filter((c) => c.op === op).length,
  };
}
