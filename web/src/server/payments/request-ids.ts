// One PayPal-Request-Id per payment action, stored on the payment before the PayPal call and reused on
// every retry, so a timeout or a double click replays the original request (CLAUDE.md rule 3).
// The id map only grows, so it uses an atomic set-if-absent instead of state_version: racing callers
// all read back the one id that won.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/types";
import { payments } from "../db/schema";

export type PaymentAction = "create_order" | "authorize" | "capture" | "void" | "payout" | `reauthorize_${number}`;

export async function ensureRequestId(db: Db, paymentId: string, action: PaymentAction): Promise<string> {
  await db
    .update(payments)
    .set({ requestIds: sql`${payments.requestIds} || jsonb_build_object(${action}::text, ${randomUUID()}::text)` })
    .where(and(eq(payments.id, paymentId), sql`not jsonb_exists(${payments.requestIds}, ${action}::text)`));
  const [row] = await db.select({ ids: payments.requestIds }).from(payments).where(eq(payments.id, paymentId));
  const id = (row?.ids as Record<string, unknown> | undefined)?.[action];
  if (typeof id !== "string") throw new Error("ensureRequestId: payment not found");
  return id;
}
