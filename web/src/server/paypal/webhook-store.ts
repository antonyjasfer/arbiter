// Stores each verified PayPal event once. A repeated event id returns the existing row.
import { eq } from "drizzle-orm";
import type { Db } from "../db/types";
import { webhookEvents } from "../db/schema";

export async function recordEvent(
  db: Db,
  e: { paypalEventId: string; eventType: string; resourceType: string; resourceId: string; payloadSha256: string },
): Promise<{ inserted: boolean; id: string }> {
  const [row] = await db
    .insert(webhookEvents)
    .values({ ...e, verified: true })
    .onConflictDoNothing({ target: webhookEvents.paypalEventId })
    .returning({ id: webhookEvents.id });
  if (row) return { inserted: true, id: row.id };
  const [existing] = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.paypalEventId, e.paypalEventId));
  if (!existing) throw new Error("webhook event vanished after conflict");
  return { inserted: false, id: existing.id };
}
