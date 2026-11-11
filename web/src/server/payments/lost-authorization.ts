// Lost authorization: PayPal's hold expired (29 days) or was voided outside Arbiter. Read back on a page
// view, a poll or an authorization webhook; never inferred from an event body. Docs: docs/arbiter-plan.md
// Rev 2 lost-authorization note; PayPal Payments v2 "Show details for authorized payment" (statuses
// CREATED, CAPTURED, DENIED, PARTIALLY_CAPTURED, VOIDED, PENDING, EXPIRED).
// - FUNDED: the milestone goes back to AGREED (authorization_lost); the client funds it again from there,
//   and startFunding supersedes this payment row with a new one.
// - Work started (SUBMITTED .. DISPUTED, or APPROVED before a capture): the milestone keeps its state; the
//   payment is marked authorization_lost, so the guard refuses approval with refund_needed.
// No PayPal write happens here.
import { and, eq, sql } from "drizzle-orm";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import type { Db } from "../db/types";
import { payments } from "../db/schema";
import type { MilestoneState } from "../milestones/state-machine";
import { transitionMilestone } from "../milestones/transition";
import { loadMilestone } from "./context";
import { PaypalApiError, type PaypalApi } from "./paypal-api";

export const LOST_AUTHORIZATION = new Set(["VOIDED", "EXPIRED"]);
const WORK_STARTED = new Set<MilestoneState>(["SUBMITTED", "VERIFYING", "REPORT_READY", "DISPUTED", "APPROVED"]);
// Payment rows whose hold is already accounted for: voided by the client, or already marked lost.
const SETTLED_ROW = new Set(["voided", "authorization_lost"]);

export type AuthorizationError = "not_found" | "paypal_refused" | "paypal_unavailable" | "conflict";

/** Read this payment's authorization back from PayPal and apply a loss. */
export async function reconcileAuthorization(db: Db, api: PaypalApi, paymentId: string): Promise<Result<{ state: MilestoneState }, AuthorizationError>> {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  const m = p && (await loadMilestone(db, p.milestoneId));
  if (!p || !m) return { ok: false, error: "not_found" };
  if (!p.authorizationId || p.supersededAt) return { ok: true, value: { state: m.state } };
  let status: string;
  try {
    status = (await api.getAuthorization(p.authorizationId)).status;
  } catch (e) {
    return { ok: false, error: e instanceof PaypalApiError && e.status < 500 ? "paypal_refused" : "paypal_unavailable" };
  }

  const isLoss = LOST_AUTHORIZATION.has(status) && !p.captureId && !SETTLED_ROW.has(p.status) && (m.state === "FUNDED" || WORK_STARTED.has(m.state));
  if (!isLoss) {
    // Keep PayPal's status for the timeline; no state moves.
    if (p.authorizationStatus !== status) {
      await db
        .update(payments)
        .set({ authorizationStatus: status, updatedAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion)));
    }
    return { ok: true, value: { state: m.state } };
  }

  const outcome = await db
    .transaction(async (tx) => {
      const rows = await tx
        .update(payments)
        .set({ status: "authorization_lost", authorizationStatus: status, updatedAt: new Date(), lastReconciledAt: new Date(), stateVersion: sql`${payments.stateVersion} + 1` })
        .where(and(eq(payments.id, p.id), eq(payments.stateVersion, p.stateVersion)))
        .returning({ id: payments.id });
      if (rows.length === 0) throw new Error("lost_race");
      let state = m.state;
      if (m.state === "FUNDED") {
        const moved = await transitionMilestone(tx, { milestoneId: m.id, expectedState: "FUNDED", expectedVersion: m.stateVersion, event: "authorization_lost" });
        if (!moved.ok) throw new Error("lost_race");
        state = moved.value.state;
      }
      await appendAudit(tx, {
        projectId: m.projectId,
        actorId: null,
        action: "authorization_lost",
        data: { milestoneId: m.id, paymentId: p.id, authorizationId: p.authorizationId, status, milestoneState: m.state, refundNeeded: true },
      });
      return { state };
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message === "lost_race") return "conflict" as const;
      throw e;
    });
  return outcome === "conflict" ? { ok: false, error: "conflict" } : { ok: true, value: outcome };
}
