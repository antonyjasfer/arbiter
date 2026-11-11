// Funding one milestone: the client's PayPal approval becomes an authorization (a hold, not a capture),
// and the milestone moves AGREED -> FUNDED. Deterministic server code only; no AI path reaches here.
// Every PayPal write uses a request id stored before the call; no DB transaction is held across a call.
// Sources: PayPal Orders v2 (create with intent AUTHORIZE, authorize) and JS SDK v6 (the buyer approves in
// the popup, then onApprove hands the orderId to the server): developer.paypal.com/sdk/js/reference.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Result } from "@/lib/result";
import { feeFor } from "../agreements/fees";
import { appendAudit } from "../audit/audit";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import type { MilestoneState } from "../milestones/state-machine";
import { centsToMoney, moneyToCents } from "../projects/money";
import { agreedPayeeEmail, isUniqueViolation, livePayment, milestoneForRole, type PaymentRow } from "./context";
import { PaypalApiError, type PaypalApi } from "./paypal-api";
import { ensureRequestId } from "./request-ids";

export type FundingError =
  | "not_found"
  | "forbidden"
  | "not_agreed"
  | "not_cancellable"
  | "payee_email_missing"
  | "already_funded"
  | "order_mismatch"
  | "order_not_approved"
  | "authorization_not_created"
  | "amount_mismatch"
  | "paypal_refused"
  | "paypal_unavailable"
  | "conflict";

const DAY_MS = 86_400_000;
export const HONOR_PERIOD_MS = 3 * DAY_MS;
// Order statuses the buyer can still approve (Orders v2). Anything else is superseded by a new order.
const APPROVABLE = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"]);

function paypalFailure(e: unknown): "paypal_refused" | "paypal_unavailable" {
  return e instanceof PaypalApiError && e.status < 500 ? "paypal_refused" : "paypal_unavailable";
}

async function supersede(db: Db, p: PaymentRow): Promise<boolean> {
  const rows = await db
    .update(payments)
    .set({ supersededAt: new Date(), updatedAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` })
    .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion), isNull(payments.supersededAt)))
    .returning({ id: payments.id });
  return rows.length === 1;
}

/** The client clicked the PayPal button: create (or reuse) this milestone's AUTHORIZE order. */
export async function startFunding(
  db: Db,
  api: PaypalApi,
  args: { userId: string; milestoneId: string },
  attempt = 0,
): Promise<Result<{ paymentId: string; orderId: string }, FundingError>> {
  const access = await milestoneForRole(db, { ...args, allowed: ["client"] });
  if (!access.ok) return access;
  const m = access.value.milestone;
  if (m.state !== "AGREED") return { ok: false, error: "not_agreed" };
  const payeeEmail = await agreedPayeeEmail(db, m.projectId);
  if (!payeeEmail) return { ok: false, error: "payee_email_missing" };

  let payment = await livePayment(db, m.id);
  if (payment?.status === "authorization_lost") {
    // Re-funding after a lost hold (FUNDED -> AGREED): the old row is kept for the record, superseded.
    if (!(await supersede(db, payment)) && attempt >= 2) return { ok: false, error: "conflict" };
    return startFunding(db, api, args, attempt + 1);
  }
  if (payment?.authorizationId) return { ok: false, error: "already_funded" };
  if (payment?.paypalOrderId) {
    // The buyer closed the popup earlier: reuse the order if PayPal still accepts it.
    let approvable: boolean;
    try {
      approvable = APPROVABLE.has((await api.getOrder(payment.paypalOrderId)).status);
    } catch (e) {
      if (!(e instanceof PaypalApiError && e.status === 404)) return { ok: false, error: "paypal_unavailable" };
      approvable = false;
    }
    if (approvable) return { ok: true, value: { paymentId: payment.id, orderId: payment.paypalOrderId } };
    if (!(await supersede(db, payment)) && attempt >= 2) return { ok: false, error: "conflict" };
    return startFunding(db, api, args, attempt + 1);
  }

  if (!payment) {
    const amountCents = moneyToCents(m.amount);
    const { feeCents, payoutCents } = feeFor(amountCents);
    try {
      payment = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(payments)
          .values({
            milestoneId: m.id,
            createdBy: args.userId,
            status: "order_pending",
            amount: m.amount,
            fee: centsToMoney(feeCents),
            payoutAmount: centsToMoney(payoutCents),
            payeeEmail,
          })
          .returning();
        // No email in audit data: both parties read the audit log.
        await appendAudit(tx, { projectId: m.projectId, actorId: args.userId, action: "funding_started", data: { milestoneId: m.id, paymentId: row!.id, amount: m.amount } });
        return row!;
      });
    } catch (e) {
      // A concurrent click created the live payment first: take the reuse path.
      if (isUniqueViolation(e) && attempt < 2) return startFunding(db, api, args, attempt + 1);
      throw e;
    }
  }

  const requestId = await ensureRequestId(db, payment.id, "create_order");
  let orderId: string;
  try {
    orderId = (await api.createOrder({ amountCents: moneyToCents(payment.amount), referenceId: m.id, customId: payment.id, requestId })).id;
  } catch (e) {
    return { ok: false, error: paypalFailure(e) };
  }
  await db
    .update(payments)
    .set({ paypalOrderId: orderId, updatedAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` })
    .where(and(eq(payments.id, payment.id), isNull(payments.paypalOrderId)));
  const now = await livePayment(db, m.id);
  if (now?.id !== payment.id || now.paypalOrderId !== orderId) return { ok: false, error: "conflict" };
  return { ok: true, value: { paymentId: payment.id, orderId } };
}

/** The buyer approved in the popup (onApprove): authorize the order and move AGREED -> FUNDED. */
export async function completeFunding(
  db: Db,
  api: PaypalApi,
  args: { userId: string; milestoneId: string; orderId: string },
): Promise<Result<{ state: MilestoneState }, FundingError>> {
  const access = await milestoneForRole(db, { userId: args.userId, milestoneId: args.milestoneId, allowed: ["client"] });
  if (!access.ok) return access;
  const m = access.value.milestone;
  const payment = await livePayment(db, m.id);
  // The order id comes from the browser: it must be this milestone's live order.
  if (!payment?.paypalOrderId || payment.paypalOrderId !== args.orderId) return { ok: false, error: "order_mismatch" };
  if (payment.authorizationId && m.state !== "AGREED") return { ok: true, value: { state: m.state } };
  if (m.state !== "AGREED") return { ok: false, error: "not_agreed" };

  const requestId = await ensureRequestId(db, payment.id, "authorize");
  let auth;
  try {
    auth = await api.authorizeOrder(payment.paypalOrderId, requestId);
  } catch (e) {
    if (e instanceof PaypalApiError && e.issue === "ORDER_NOT_APPROVED") return { ok: false, error: "order_not_approved" };
    return { ok: false, error: paypalFailure(e) };
  }
  if (auth.currency !== "USD" || auth.amountCents !== moneyToCents(payment.amount)) return { ok: false, error: "amount_mismatch" };
  if (auth.status !== "CREATED") return { ok: false, error: "authorization_not_created" };

  const authorizedAt = auth.createTime ?? new Date();
  const outcome = await db
    .transaction(async (tx) => {
      const updated = await tx
        .update(payments)
        .set({
          status: "authorized",
          authorizationId: auth.id,
          authorizationStatus: auth.status,
          authorizationExpiresAt: auth.expirationTime,
          honorPeriodEndsAt: new Date(authorizedAt.getTime() + HONOR_PERIOD_MS),
          lastReconciledAt: new Date(),
          updatedAt: new Date(),
          stateVersion: sql`${payments.stateVersion} + 1`,
        })
        .where(and(eq(payments.id, payment.id), eq(payments.stateVersion, payment.stateVersion), isNull(payments.authorizationId)))
        .returning({ id: payments.id });
      if (updated.length === 0) return "lost_race" as const;
      const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: "AGREED", expectedVersion: m.stateVersion, event: "authorized" });
      if (!moved.ok) throw new Error("milestone_moved");
      await appendAudit(tx, {
        projectId: m.projectId,
        actorId: args.userId,
        action: "funded",
        data: { milestoneId: m.id, paymentId: payment.id, orderId: payment.paypalOrderId, authorizationId: auth.id, amount: payment.amount, expiresAt: auth.expirationTime?.toISOString() ?? null },
      });
      return "funded" as const;
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message === "milestone_moved") return "lost_race" as const;
      throw e;
    });
  if (outcome === "funded") return { ok: true, value: { state: "FUNDED" } };

  // Someone else recorded the same authorization first (a replay): report what is there now.
  const again = await milestoneForRole(db, { userId: args.userId, milestoneId: m.id, allowed: ["client"] });
  const now = await livePayment(db, m.id);
  if (again.ok && now?.authorizationId === auth.id && again.value.milestone.state !== "AGREED") return { ok: true, value: { state: again.value.milestone.state } };
  return { ok: false, error: "conflict" };
}

/**
 * The client cancels a FUNDED milestone (nothing submitted yet): void the hold with PayPal, then move
 * FUNDED -> CANCELLED. Source: PayPal Payments v2 "Void authorized payment" (204 No Content). A void whose
 * response was lost is refused as already voided on the retry, so a refusal is read back before giving up.
 */
export async function cancelFunding(db: Db, api: PaypalApi, args: { userId: string; milestoneId: string }): Promise<Result<{ state: MilestoneState }, FundingError>> {
  const access = await milestoneForRole(db, { ...args, allowed: ["client"] });
  if (!access.ok) return access;
  const m = access.value.milestone;
  const payment = await livePayment(db, m.id);
  if (m.state === "CANCELLED" && payment?.status === "voided") return { ok: true, value: { state: "CANCELLED" } };
  if (m.state !== "FUNDED" || !payment?.authorizationId) return { ok: false, error: "not_cancellable" };

  const requestId = await ensureRequestId(db, payment.id, "void");
  try {
    await api.voidAuthorization(payment.authorizationId, requestId);
  } catch (e) {
    if (!(e instanceof PaypalApiError && e.status < 500)) return { ok: false, error: "paypal_unavailable" };
    let status: string;
    try {
      status = (await api.getAuthorization(payment.authorizationId)).status;
    } catch {
      return { ok: false, error: "paypal_unavailable" };
    }
    if (status !== "VOIDED") return { ok: false, error: "paypal_refused" };
  }

  // Re-read: storing the request id may have bumped the row's version.
  const p = await livePayment(db, m.id);
  if (!p || p.id !== payment.id) return { ok: false, error: "conflict" };
  const outcome = await db
    .transaction(async (tx) => {
      const rows = await tx
        .update(payments)
        .set({ status: "voided", authorizationStatus: "VOIDED", voidedAt: new Date(), updatedAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion)))
        .returning({ id: payments.id });
      if (rows.length === 0) throw new Error("milestone_moved");
      const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: "FUNDED", expectedVersion: m.stateVersion, event: "cancel" });
      if (!moved.ok) throw new Error("milestone_moved");
      await appendAudit(tx, { projectId: m.projectId, actorId: args.userId, action: "funding_voided", data: { milestoneId: m.id, paymentId: p.id, authorizationId: p.authorizationId } });
      return "cancelled" as const;
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message === "milestone_moved") return "lost_race" as const;
      throw e;
    });
  if (outcome === "cancelled") return { ok: true, value: { state: "CANCELLED" } };
  const again = await livePayment(db, m.id);
  return again?.status === "voided" ? { ok: true, value: { state: "CANCELLED" } } : { ok: false, error: "conflict" };
}
