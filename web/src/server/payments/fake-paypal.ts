// Tests only: an in-memory PayPal that follows PayPal's idempotency rules strictly, so replay tests mean
// something. A request id that was seen before returns the original result; a second authorize of one
// order with a new request id is refused with 422 ORDER_ALREADY_AUTHORIZED, as PayPal does; a second
// capture of one authorization and a reused sender_batch_id are refused the same way.
import { PaypalApiError, type PaypalApi, type PaypalAuthorization, type PaypalCapture, type PaypalOrder, type PaypalPayoutBatch } from "./paypal-api";

type Order = { id: string; status: string; amountCents: number; referenceId: string; customId: string };

const DAY_MS = 86_400_000;

export function createFakePaypal(opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${String(++seq).padStart(6, "0")}`;
  const orders = new Map<string, Order>();
  const authorizations = new Map<string, PaypalAuthorization & { orderId: string }>();
  const captures = new Map<string, PaypalCapture & { authorizationId: string }>();
  const batches = new Map<string, PaypalPayoutBatch & { senderBatchId: string; receiver: string; amountCents: number }>();
  const byRequestId = new Map<string, unknown>();
  const calls: { op: string; requestId?: string; id?: string }[] = [];
  const failNext = new Map<string, Error>();
  let nextCaptureStatus = "COMPLETED";
  let nextCaptureReason: string | null = null;
  let nextPayoutItemStatus = "SUCCESS";
  let nextCaptureAmount: number | null = null;

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

  function read<T>(op: string, id: string, map: Map<string, T>): T {
    calls.push({ op, id });
    const injected = failNext.get(op);
    if (injected) {
      failNext.delete(op);
      throw injected;
    }
    const v = map.get(id);
    if (!v) throw new PaypalApiError(404, "RESOURCE_NOT_FOUND");
    return structuredClone(v);
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
      const o = read("getOrder", orderId, orders);
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
    async getAuthorization(authorizationId) {
      const { orderId: _o, ...a } = read("getAuthorization", authorizationId, authorizations);
      return a;
    },
    async captureAuthorization(authorizationId, args) {
      return replay("captureAuthorization", args.requestId, (): PaypalCapture => {
        const a = authorizations.get(authorizationId);
        if (!a) throw new PaypalApiError(404, "RESOURCE_NOT_FOUND");
        if (a.status === "CAPTURED") throw new PaypalApiError(422, "AUTHORIZATION_ALREADY_CAPTURED");
        if (a.status !== "CREATED") throw new PaypalApiError(422, "AUTHORIZATION_VOIDED");
        if (args.amountCents > a.amountCents) throw new PaypalApiError(422, "MAX_CAPTURE_AMOUNT_EXCEEDED");
        a.status = "CAPTURED";
        const c: PaypalCapture = { id: nextId("CAP"), status: nextCaptureStatus, statusReason: nextCaptureReason, amountCents: nextCaptureAmount ?? args.amountCents, currency: "USD" };
        nextCaptureAmount = null;
        captures.set(c.id, { ...c, authorizationId });
        return c;
      });
    },
    async getCapture(captureId) {
      const { authorizationId: _a, ...c } = read("getCapture", captureId, captures);
      return c;
    },
    async createPayout(args) {
      return replay("createPayout", args.requestId, () => {
        if ([...batches.values()].some((b) => b.senderBatchId === args.senderBatchId)) throw new PaypalApiError(400, "DUPLICATE_SENDER_BATCH_ID");
        const b = {
          batchId: nextId("BATCH"),
          batchStatus: "PENDING",
          items: [{ itemId: nextId("ITEM"), status: nextPayoutItemStatus }],
          senderBatchId: args.senderBatchId,
          receiver: args.receiver,
          amountCents: args.amountCents,
        };
        batches.set(b.batchId, b);
        return { batchId: b.batchId, batchStatus: b.batchStatus };
      });
    },
    async getPayoutBatch(batchId) {
      const { senderBatchId: _s, receiver: _r, amountCents: _c, ...b } = read("getPayoutBatch", batchId, batches);
      return b;
    },
  };

  return {
    api,
    calls,
    orders,
    authorizations,
    captures,
    batches,
    /** The buyer approves the order in the PayPal popup. */
    approve(orderId: string) {
      const o = orders.get(orderId);
      if (!o) throw new Error("fake: no such order");
      o.status = "APPROVED";
    },
    /** The status the next new capture gets (sandbox captures can come back PENDING / PENDING_REVIEW). */
    setNextCaptureStatus(status: string, reason: string | null = null) {
      nextCaptureStatus = status;
      nextCaptureReason = reason;
    },
    /** PayPal settles (or denies) an existing capture later. */
    setCaptureStatus(captureId: string, status: string) {
      const c = captures.get(captureId);
      if (!c) throw new Error("fake: no such capture");
      c.status = status;
    },
    setNextPayoutItemStatus(status: string) {
      nextPayoutItemStatus = status;
    },
    setPayoutItemStatus(batchId: string, status: string) {
      const b = batches.get(batchId);
      if (!b) throw new Error("fake: no such batch");
      b.items = b.items.map((i) => ({ ...i, status }));
      b.batchStatus = status === "SUCCESS" ? "SUCCESS" : b.batchStatus;
    },
    /** A batch read back with no items yet (PayPal can return the header before the items). */
    setPayoutBatchOnly(batchId: string, batchStatus: string) {
      const b = batches.get(batchId);
      if (!b) throw new Error("fake: no such batch");
      b.items = [];
      b.batchStatus = batchStatus;
    },
    /** The next new capture reports this amount (to test a mismatched read-back). */
    setNextCaptureAmount(cents: number) {
      nextCaptureAmount = cents;
    },
    /** The next call of `op` fails with `error` (for timeouts and outages). */
    failNext(op: string, error: Error) {
      failNext.set(op, error);
    },
    count: (op: string) => calls.filter((c) => c.op === op).length,
  };
}
