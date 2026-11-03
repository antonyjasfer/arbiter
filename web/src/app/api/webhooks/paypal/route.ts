import { getDb } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import { getPaypalResource, verifyWebhookSignature } from "@/server/paypal/client";
import { handlePaypalWebhook } from "@/server/paypal/webhook-handler";

export async function POST(request: Request): Promise<Response> {
  return handlePaypalWebhook(request, {
    db: getDb(),
    webhookId: serverEnv().PAYPAL_WEBHOOK_ID,
    verify: verifyWebhookSignature,
    fetchResource: getPaypalResource,
    log: (line) => console.log(`paypal-webhook ${line}`),
  });
}
