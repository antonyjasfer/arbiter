// The few fields Arbiter needs from a PayPal webhook event. The resource id lives in a different
// place per resource type (checked against real sandbox events, 3 Nov 2026).
import { z } from "zod";
import type { Result } from "@/lib/result";

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().min(1),
  resource: z.object({
    id: z.string().optional(),
    payout_item_id: z.string().optional(),
    batch_header: z.object({ payout_batch_id: z.string().optional() }).optional(),
  }),
});

export type WebhookEvent = { eventId: string; eventType: string; resourceType: string; resourceId: string };

export function parseWebhookEvent(raw: string): Result<WebhookEvent, "invalid_event"> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_event" };
  }
  const e = eventSchema.safeParse(json);
  if (!e.success) return { ok: false, error: "invalid_event" };
  const r = e.data.resource;
  const resourceId =
    e.data.resource_type === "payouts" ? r.batch_header?.payout_batch_id : e.data.resource_type === "payouts_item" ? r.payout_item_id : r.id;
  if (!resourceId) return { ok: false, error: "invalid_event" };
  return { ok: true, value: { eventId: e.data.id, eventType: e.data.event_type, resourceType: e.data.resource_type, resourceId } };
}
