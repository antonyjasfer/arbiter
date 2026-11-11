// The stored payment state the project page polls with GET. Read-only: no PayPal call and no write, so a
// crawler, prefetch or <img src> on the GET URL can never move money. Moving state is reconcile.ts's job,
// reached only through a same-origin POST, a server action or a verified webhook.
import { eq } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import type { MilestoneState } from "../milestones/state-machine";
import { loadMilestone, milestoneForRole } from "./context";

export type PaymentView = {
  state: MilestoneState;
  paymentStatus: string;
  captureStatus: string | null;
  payoutStatus: string | null;
  /** The last step's error code if PayPal could not be reached or refused; the next poll retries. */
  lastError: string | null;
};

/** The view of one payment row as stored now. */
export async function readPaymentView(db: Db, paymentId: string, lastError: string | null): Promise<Result<PaymentView, "not_found">> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  return { ok: true, value: { state: m.state, paymentStatus: p.status, captureStatus: p.captureStatus, payoutStatus: p.payoutStatus, lastError } };
}

/** Members only; a malformed, unknown or superseded payment id is not_found. */
export async function getPaymentView(db: Db, args: { userId: string; paymentId: string }): Promise<Result<PaymentView, "not_found">> {
  if (!parseId(args.paymentId)) return { ok: false, error: "not_found" };
  const [p] = await db.select({ milestoneId: payments.milestoneId, supersededAt: payments.supersededAt }).from(payments).where(eq(payments.id, args.paymentId));
  if (!p || p.supersededAt) return { ok: false, error: "not_found" };
  const access = await milestoneForRole(db, { userId: args.userId, milestoneId: p.milestoneId, allowed: ["client", "freelancer"] });
  if (!access.ok) return { ok: false, error: "not_found" };
  return readPaymentView(db, args.paymentId, null);
}
