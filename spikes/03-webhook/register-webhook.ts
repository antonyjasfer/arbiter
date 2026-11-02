// Creates the PayPal sandbox webhook through the API and stores its id in .env.local as PAYPAL_WEBHOOK_ID.
// Safe to re-run: an existing webhook for the same URL is reused. Prints no secrets.
// Usage (from spikes/): npx tsx 03-webhook/register-webhook.ts [https-url]
// Source: PayPal Webhooks v1 reference (POST and GET /v1/notifications/webhooks).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { requireEnvOrExit, setEnvValue } from "../lib/env.js";
import { getAccessToken, newRequestId, PayPalError, ppFetch } from "../lib/paypal.js";

const DEFAULT_URL = "https://arbiter-q41f.onrender.com/webhook";
const EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
];

const ENV_FILE = new URL("../../.env.local", import.meta.url);
const OUT_DIR = new URL("../.out/", import.meta.url);
const REQUEST_ID_FILE = new URL("webhook-register.json", OUT_DIR);

type Webhook = { id: string; url: string; event_types: { name: string }[] };

/** Reuses the stored PayPal-Request-Id for this URL, so a retried create stays idempotent. */
function requestIdFor(url: string): string {
  try {
    const saved = JSON.parse(readFileSync(REQUEST_ID_FILE, "utf8")) as { url?: string; requestId?: string };
    if (saved.url === url && saved.requestId) return saved.requestId;
  } catch {
    // no stored id yet
  }
  const requestId = newRequestId();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REQUEST_ID_FILE, JSON.stringify({ url, requestId }, null, 2));
  return requestId;
}

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  if (!url.startsWith("https://")) throw new Error("webhook url must be https");
  const env = requireEnvOrExit(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENVIRONMENT"]);
  const token = await getAccessToken(env as Parameters<typeof getAccessToken>[0]);
  console.log("oauth token obtained (value not printed)");

  const { body: list } = await ppFetch<{ webhooks?: Webhook[] }>(token, "GET", "/v1/notifications/webhooks");
  console.log(`existing webhooks on this app: ${list.webhooks?.length ?? 0}`);
  let webhook = list.webhooks?.find((w) => w.url === url);
  if (webhook) {
    console.log("a webhook for this url already exists; reusing it");
  } else {
    const created = await ppFetch<Webhook>(token, "POST", "/v1/notifications/webhooks", {
      requestId: requestIdFor(url),
      body: { url, event_types: EVENT_TYPES.map((name) => ({ name })) },
    });
    console.log(`create returned HTTP ${created.status}`);
    webhook = created.body;
  }

  // Read it back from PayPal rather than trusting the create response.
  const { body: stored } = await ppFetch<Webhook>(token, "GET", `/v1/notifications/webhooks/${webhook.id}`);
  const subscribed = stored.event_types.map((e) => e.name);
  const missing = EVENT_TYPES.filter((name) => !subscribed.includes(name));
  console.log(`webhook id: ${stored.id}`);
  console.log(`url: ${stored.url}`);
  console.log(`event types (${subscribed.length}): ${subscribed.join(", ")}`);
  if (stored.url !== url || missing.length) {
    console.error(`mismatch: url ok=${stored.url === url}, missing events: ${missing.join(", ") || "none"}. .env.local not changed.`);
    process.exit(1);
  }

  writeFileSync(ENV_FILE, setEnvValue(readFileSync(ENV_FILE, "utf8"), "PAYPAL_WEBHOOK_ID", stored.id));
  console.log("PAYPAL_WEBHOOK_ID written to .env.local");
}

main().catch((e) => {
  if (e instanceof PayPalError) console.error(`PayPal rejected the request: ${e.message}`);
  else console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
