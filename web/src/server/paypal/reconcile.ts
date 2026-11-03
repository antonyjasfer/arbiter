// Reconcile by fetch: never trust the event body or its order; read the resource back from PayPal
// (read-only GET) and store what PayPal says now. Phase 2 changes no milestone state; Phase 5 does.
import { eq } from "drizzle-orm";
import type { Db } from "../db/types";
import { webhookEvents } from "../db/schema";

const PATHS: Record<string, string> = {
  capture: "/v2/payments/captures/",
  authorization: "/v2/payments/authorizations/",
  "checkout-order": "/v2/checkout/orders/",
  payouts: "/v1/payments/payouts/",
  payouts_item: "/v1/payments/payouts-item/",
};

export function resourcePathFor(resourceType: string, resourceId: string): string | null {
  const base = PATHS[resourceType];
  if (!base || !/^[A-Za-z0-9-]+$/.test(resourceId)) return null;
  return base + resourceId;
}

export function statusOf(resourceType: string, resource: unknown): string {
  const r = (resource ?? {}) as { status?: unknown; transaction_status?: unknown; batch_header?: { batch_status?: unknown } };
  const value = resourceType === "payouts" ? r.batch_header?.batch_status : resourceType === "payouts_item" ? r.transaction_status : r.status;
  return typeof value === "string" ? value : "unknown";
}

export async function reconcileEvent(
  db: Db,
  event: { id: string; resourceType: string; resourceId: string },
  fetchResource: (path: string) => Promise<unknown>,
): Promise<void> {
  const path = resourcePathFor(event.resourceType, event.resourceId);
  let status: string;
  if (!path) status = "unsupported";
  else {
    try {
      status = statusOf(event.resourceType, await fetchResource(path));
    } catch {
      status = "error";
    }
  }
  await db.update(webhookEvents).set({ reconciledStatus: status, reconciledAt: new Date() }).where(eq(webhookEvents.id, event.id));
}
