// Spike helper (throwaway). Thin PayPal REST client over fetch so we control PayPal-Request-Id.
// Sandbox host only. Source: PayPal REST docs (OAuth 2.0 client credentials, Orders v2, Payments v2, Payouts v1).
import { randomUUID } from "node:crypto";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    public readonly status: number,
    public readonly debugId: string | undefined,
    public readonly name_: string | undefined,
    message: string,
  ) {
    super(`PayPal ${status}${name_ ? ` ${name_}` : ""}: ${message}${debugId ? ` (debug id ${debugId})` : ""}`);
    this.name = "PayPalError";
  }
}

export function newRequestId(): string {
  return randomUUID();
}

export async function getAccessToken(env: {
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENVIRONMENT: string;
}): Promise<string> {
  if (env.PAYPAL_ENVIRONMENT !== "SANDBOX") {
    throw new Error("Refusing to run: PAYPAL_ENVIRONMENT must be SANDBOX (live credentials are never used).");
  }
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${SANDBOX_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new PayPalError(res.status, res.headers.get("paypal-debug-id") ?? undefined, json.error, json.error_description ?? "token request failed");
  }
  return json.access_token;
}

export async function ppFetch<T>(
  token: string,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; requestId?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T; requestId?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...opts.headers,
  };
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  const res = await fetch(`${SANDBOX_BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const b = (body ?? {}) as { name?: string; message?: string };
    throw new PayPalError(res.status, res.headers.get("paypal-debug-id") ?? undefined, b.name, b.message ?? "request failed");
  }
  return { status: res.status, body: body as T, requestId: opts.requestId };
}
