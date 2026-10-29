// Builds the body for POST /v1/notifications/verify-webhook-signature.
// PayPal verifies the signature over the EXACT bytes it sent, so `webhook_event` must be the raw body verbatim:
// never JSON.stringify(JSON.parse(raw)). Source: PayPal Webhooks v1 "Verify webhook signature" reference.
const HEADER_FOR_FIELD = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export function buildVerifyBody(headers: Record<string, string | undefined>, rawBody: string, webhookId: string): string {
  const lower: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  if (!rawBody.trim()) throw new Error("empty webhook body");
  const parts: string[] = [];
  for (const [field, header] of Object.entries(HEADER_FOR_FIELD)) {
    const value = lower[header];
    if (!value) throw new Error(`missing required header: ${header}`);
    parts.push(`${JSON.stringify(field)}:${JSON.stringify(value)}`);
  }
  parts.push(`"webhook_id":${JSON.stringify(webhookId)}`);
  // Concatenate the raw event text; do not parse and re-serialize it.
  return `{${parts.join(",")},"webhook_event":${rawBody}}`;
}
