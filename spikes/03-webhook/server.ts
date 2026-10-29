// SPIKE 3 (throwaway): PayPal webhook receiver that verifies signatures via PayPal's postback endpoint.
// Deployable unit: imports nothing from ../lib. Deploy as a Render Free web service (root dir spikes/03-webhook).
// Logs only: event id, event type, verification status, seconds since process start. No payloads, no headers.
import { createServer } from "node:http";
import { buildVerifyBody } from "./verify.js";

const PP = "https://api-m.sandbox.paypal.com";
const startedAt = Date.now();
const port = Number(process.env.PORT ?? 3000);

if (process.env.PAYPAL_ENVIRONMENT !== "SANDBOX") {
  console.error("Refusing to start: PAYPAL_ENVIRONMENT must be SANDBOX");
  process.exit(1);
}

async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID ?? "";
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  const res = await fetch(`${PP}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !json.access_token) throw new Error(`oauth failed with HTTP ${res.status}`);
  return json.access_token;
}

async function readRaw(req: import("node:http").IncomingMessage, limit = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respond(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function secondsUp(): string {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return respond(res, 200, { ok: true, uptimeSeconds: Number(secondsUp()) });
    if (req.method !== "POST" || req.url !== "/webhook") return respond(res, 404, { error: "not found" });

    const raw = await readRaw(req);
    let eventId = "?";
    let eventType = "?";
    try {
      const e = JSON.parse(raw) as { id?: string; event_type?: string };
      eventId = String(e.id ?? "?").slice(0, 64);
      eventType = String(e.event_type ?? "?").slice(0, 64);
    } catch {
      // not JSON: verification below will fail anyway
    }

    const webhookId = process.env.PAYPAL_WEBHOOK_ID ?? "";
    if (!webhookId) {
      console.log(`event=${eventId} type=${eventType} verification=NOT_CONFIGURED up=${secondsUp()}s`);
      return respond(res, 503, { error: "webhook_id not configured" });
    }

    let body: string;
    try {
      body = buildVerifyBody(req.headers as Record<string, string | undefined>, raw, webhookId);
    } catch (e) {
      console.log(`event=${eventId} type=${eventType} verification=BAD_REQUEST reason=${(e as Error).message} up=${secondsUp()}s`);
      return respond(res, 400, { error: "invalid webhook request" });
    }

    const token = await accessToken();
    const v = await fetch(`${PP}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    const result = (await v.json().catch(() => ({}))) as { verification_status?: string };
    const status = v.ok ? String(result.verification_status ?? "UNKNOWN") : `HTTP_${v.status}`;
    console.log(`event=${eventId} type=${eventType} verification=${status} up=${secondsUp()}s`);
    if (status === "SUCCESS") return respond(res, 200, { ok: true });
    return respond(res, 400, { error: "signature verification failed" });
  } catch (e) {
    console.log(`error=${(e as Error).message} up=${secondsUp()}s`);
    return respond(res, 500, { error: "internal error" });
  }
});

server.listen(port, () => console.log(`webhook spike listening on :${port}; PAYPAL_WEBHOOK_ID ${process.env.PAYPAL_WEBHOOK_ID ? "set" : "NOT set"}`));
