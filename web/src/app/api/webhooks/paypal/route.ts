import { getDb } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import { getPaypalApi } from "@/server/payments/default-api";
import { reconcileWebhookResource } from "@/server/payments/reconcile";
import { getPaypalResource, verifyWebhookSignature } from "@/server/paypal/client";
import { handlePaypalWebhook } from "@/server/paypal/webhook-handler";

export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  return handlePaypalWebhook(request, {
    db,
    // Only after PayPal verified the signature; state comes from PayPal's read-back, never the body.
    reconcilePayment: (r) => reconcileWebhookResource(db, getPaypalApi(), r),
    webhookId: serverEnv().PAYPAL_WEBHOOK_ID,
    verify: verifyWebhookSignature,
    fetchResource: getPaypalResource,
    log: (line) => console.log(`paypal-webhook ${line}`),
  });
}
