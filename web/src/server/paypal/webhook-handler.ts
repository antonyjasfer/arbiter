// POST /api/webhooks/paypal. Verify with PayPal (over the raw body), store once, reconcile by fetch.
// Answers: 503 not configured, 400 bad or unverified request, 200 stored or duplicate, 500 our failure (PayPal retries).
import { createHash } from "node:crypto";
import type { Db } from "../db/types";
import { reconcileEvent } from "./reconcile";
import { parseWebhookEvent } from "./webhook-event";
import { recordEvent } from "./webhook-store";
import { buildVerifyBody } from "./webhook-verify";

export type WebhookDeps = {
  db: Db;
  webhookId: string | undefined;
  /** POSTs the verify body to PayPal and returns verification_status. */
  verify: (verifyBody: string) => Promise<string>;
  /** Read-only GET of a PayPal resource path. */
  fetchResource: (path: string) => Promise<unknown>;
  log: (line: string) => void;
  /**
   * Phase 5: move payment state from PayPal's read-back of this resource (server/payments). Runs on every
   * verified delivery, duplicates included: it is idempotent, and a redelivery after a failed round must
   * try again. Returns "retry" when PayPal couldn't be read; throws when it refused for good.
   */
  reconcilePayment?: (r: { resourceType: string; resourceId: string }) => Promise<{ outcome: string }>;
};

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function handlePaypalWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (!deps.webhookId) return json(503, { error: "webhook_id not configured" });

  const raw = await request.text();
  const parsed = parseWebhookEvent(raw);
  const label = parsed.ok ? `event=${parsed.value.eventId} type=${parsed.value.eventType}` : "event=? type=?";

  let verifyBody: string;
  try {
    verifyBody = buildVerifyBody(Object.fromEntries(request.headers), raw, deps.webhookId);
  } catch (e) {
    deps.log(`${label} verification=BAD_REQUEST reason=${(e as Error).message}`);
    return json(400, { error: "invalid webhook request" });
  }

  try {
    const status = await deps.verify(verifyBody);
    deps.log(`${label} verification=${status}`);
    if (status !== "SUCCESS") return json(400, { error: "signature verification failed" });
    // Verified but not a shape we use: acknowledge, or PayPal retries it for days and then drops it.
    if (!parsed.ok) {
      deps.log(`${label} ignored=unparseable`);
      return json(200, { ok: true, ignored: true });
    }

    const e = parsed.value;
    const stored = await recordEvent(deps.db, {
      paypalEventId: e.eventId,
      eventType: e.eventType,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      payloadSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    });
    // A duplicate whose earlier reconcile failed or never ran is reconciled again (the GET is read-only).
    const needsReconcile = stored.inserted || stored.reconciledStatus === null || stored.reconciledStatus === "error";
    if (needsReconcile) {
      await reconcileEvent(deps.db, { id: stored.id, resourceType: e.resourceType, resourceId: e.resourceId }, deps.fetchResource);
    }
    if (!stored.inserted) deps.log(`${label} duplicate=true reconciled=${needsReconcile}`);
    if (deps.reconcilePayment) {
      let outcome: string;
      try {
        outcome = (await deps.reconcilePayment({ resourceType: e.resourceType, resourceId: e.resourceId })).outcome;
      } catch (err) {
        // A refusal a redelivery wouldn't change (e.g. an amount mismatch): logged for a human, acknowledged.
        deps.log(`${label} payment=error reason=${(err as Error).message}`);
        return json(200, { ok: true, duplicate: !stored.inserted });
      }
      deps.log(`${label} payment=${outcome}`);
      if (outcome === "retry") return json(500, { error: "PayPal unavailable, retry" });
    }
    return json(200, { ok: true, duplicate: !stored.inserted });
  } catch (e) {
    deps.log(`${label} error=${(e as Error).message}`);
    return json(500, { error: "internal error" });
  }
}
