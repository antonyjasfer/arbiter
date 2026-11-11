// Points the PayPal sandbox webhook at a URL and stores its id in .env.local as PAYPAL_WEBHOOK_ID.
// Never creates a duplicate: reuses a webhook already at the URL, otherwise PATCHes the stored one
// (same id, so PAYPAL_WEBHOOK_ID stays valid), and only creates when none exists. Prints no secrets.
// Usage (from spikes/): npx tsx 03-webhook/register-webhook.ts [https-url]
// Source: PayPal Webhooks v1 reference (GET/POST /v1/notifications/webhooks, PATCH /v1/notifications/webhooks/{id}).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { requireEnv, requireEnvOrExit, setEnvValue } from "../lib/env.js";
import { getAccessToken, newRequestId, PayPalError, ppFetch } from "../lib/paypal.js";
import { planRegistration, requestKey, WEBHOOK_EVENT_TYPES } from "./register-plan.js";

const DEFAULT_URL = "https://arbiter-q41f.onrender.com/api/webhooks/paypal";
const EVENT_TYPES = WEBHOOK_EVENT_TYPES;

const ENV_FILE = new URL("../../.env.local", import.meta.url);
const OUT_DIR = new URL("../.out/", import.meta.url);
const REQUEST_ID_FILE = new URL("webhook-register.json", OUT_DIR);

type Webhook = { id: string; url: string; event_types: { name: string }[] };

/**
 * Reuses the stored PayPal-Request-Id only for the same action, URL and body, so a retried write stays
 * idempotent but a different PATCH (e.g. new event types) is never replayed as an earlier one.
 */
function requestIdFor(action: string, url: string, body: unknown): string {
  const key = requestKey(action, url, body);
  try {
    const saved = JSON.parse(readFileSync(REQUEST_ID_FILE, "utf8")) as { key?: string; requestId?: string };
    if (saved.key === key && saved.requestId) return saved.requestId;
  } catch {
    // no stored id yet
  }
  const requestId = newRequestId();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REQUEST_ID_FILE, JSON.stringify({ key, requestId }, null, 2));
  return requestId;
}

function storedWebhookId(): string | undefined {
  try {
    return requireEnv(["PAYPAL_WEBHOOK_ID"]).PAYPAL_WEBHOOK_ID;
  } catch {
    return undefined;
  }
}

async function main() {
  const url = process.argv[2] ?? DEFAULT_URL;
  if (!url.startsWith("https://")) throw new Error("webhook url must be https");
  const env = requireEnvOrExit(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENVIRONMENT"]);
  const token = await getAccessToken(env as Parameters<typeof getAccessToken>[0]);
  console.log("oauth token obtained (value not printed)");

  const { body: list } = await ppFetch<{ webhooks?: Webhook[] }>(token, "GET", "/v1/notifications/webhooks");
  const existing = (list.webhooks ?? []).map((w) => ({ id: w.id, url: w.url, eventTypes: w.event_types.map((e) => e.name) }));
  console.log(`existing webhooks on this app: ${existing.length}`);

  const plan = planRegistration({ existing, storedId: storedWebhookId(), targetUrl: url, wanted: EVENT_TYPES });
  let id: string;
  if (plan.action === "reuse") {
    console.log("a webhook for this url already exists; reusing it");
    id = plan.id;
  } else if (plan.action === "patch") {
    console.log(`patching the stored webhook: ${plan.patch.map((p) => p.path).join(", ")}`);
    const r = await ppFetch<Webhook>(token, "PATCH", `/v1/notifications/webhooks/${plan.id}`, { requestId: requestIdFor("patch", url, plan.patch), body: plan.patch });
    console.log(`patch returned HTTP ${r.status}`);
    id = plan.id;
  } else {
    const r = await ppFetch<Webhook>(token, "POST", "/v1/notifications/webhooks", {
      requestId: requestIdFor("create", url, EVENT_TYPES),
      body: { url, event_types: EVENT_TYPES.map((name) => ({ name })) },
    });
    console.log(`create returned HTTP ${r.status}`);
    id = r.body.id;
  }

  // Read it back from PayPal rather than trusting the write response.
  const { body: stored } = await ppFetch<Webhook>(token, "GET", `/v1/notifications/webhooks/${id}`);
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
