// Decides how to point the PayPal webhook at a URL without ever creating a duplicate.
// The events Arbiter subscribes to. Phase 5 adds CAPTURE.DENIED, REVERSED and REFUNDED; each only triggers
// a read-back from PayPal (the event body is never trusted). Names: PayPal Webhooks event-names reference.
export const WEBHOOK_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
];

/** A write's idempotency key: same action, url and body reuse a request id; any change gets a new one. */
export function requestKey(action: string, url: string, body: unknown): string {
  return `${action} ${url} ${JSON.stringify(body)}`;
}

export type ExistingWebhook = { id: string; url: string; eventTypes: string[] };
export type PatchOp = { op: "replace"; path: "/url" | "/event_types"; value: unknown };
export type RegistrationPlan = { action: "reuse"; id: string } | { action: "patch"; id: string; patch: PatchOp[] } | { action: "create" };

export function planRegistration(args: { existing: ExistingWebhook[]; storedId?: string; targetUrl: string; wanted: string[] }): RegistrationPlan {
  const hasAll = (w: ExistingWebhook) => args.wanted.every((name) => w.eventTypes.includes(name));
  const atTarget = args.existing.find((w) => w.url === args.targetUrl && hasAll(w));
  if (atTarget) return { action: "reuse", id: atTarget.id };
  const stored = args.storedId ? args.existing.find((w) => w.id === args.storedId) : undefined;
  if (!stored) return { action: "create" };
  const patch: PatchOp[] = [];
  if (stored.url !== args.targetUrl) patch.push({ op: "replace", path: "/url", value: args.targetUrl });
  if (!hasAll(stored)) patch.push({ op: "replace", path: "/event_types", value: args.wanted.map((name) => ({ name })) });
  return patch.length ? { action: "patch", id: stored.id, patch } : { action: "reuse", id: stored.id };
}
