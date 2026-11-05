import "server-only";
// Sandbox-only PayPal REST client: OAuth, webhook signature verification, read-only GETs, and (Phase 5)
// the authenticated transport `paypalHttp`. paypalHttp can reach money-moving endpoints, so only
// server/payments may import it (CLAUDE.md rule 1; enforced by server/payments/boundary.test.ts).
// Source: PayPal REST docs (OAuth 2.0 client credentials; Webhooks v1 verify-webhook-signature;
// PayPal-Request-Id idempotency header: developer.paypal.com/api/rest/reference/idempotency).
import type { PaypalHttp } from "../payments/paypal-api";
import { serverEnv } from "../env";
import { tokenResponseSchema, verifyResponseSchema } from "./responses";

const SANDBOX = "https://api-m.sandbox.paypal.com";
let cached: { token: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const env = serverEnv();
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = tokenResponseSchema.safeParse(await res.json().catch(() => ({})));
  if (!res.ok || !body.success) throw new Error(`PayPal oauth failed with HTTP ${res.status}`);
  cached = { token: body.data.access_token, expiresAt: Date.now() + (body.data.expires_in ?? 300) * 1000 };
  return cached.token;
}

export async function verifyWebhookSignature(verifyBody: string): Promise<string> {
  const res = await fetch(`${SANDBOX}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: verifyBody,
  });
  if (!res.ok) throw new Error(`PayPal verify failed with HTTP ${res.status}`);
  const body = verifyResponseSchema.safeParse(await res.json().catch(() => ({})));
  return body.success ? body.data.verification_status : "UNKNOWN";
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,108}$/;

// Phase 5 transport. Never throws on a 4xx/5xx (the caller maps PayPal's answer); throws only when the
// network fails. Every POST carries the caller's stored PayPal-Request-Id.
export const paypalHttp: PaypalHttp = {
  async post(path, body, opts) {
    if (!path.startsWith("/") || !REQUEST_ID.test(opts.requestId)) throw new Error("paypalHttp: bad path or request id");
    const res = await fetch(`${SANDBOX}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": opts.requestId,
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  },
  async get(path) {
    if (!path.startsWith("/")) throw new Error("paypalHttp: bad path");
    const res = await fetch(`${SANDBOX}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  },
};

// Returns unknown on purpose: reconcile.ts's statusOf reads only the status field, defensively.
export async function getPaypalResource(path: string): Promise<unknown> {
  const res = await fetch(`${SANDBOX}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`PayPal GET failed with HTTP ${res.status}`);
  return res.json();
}
