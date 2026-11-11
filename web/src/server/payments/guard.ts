// The payment guard (CLAUDE.md rule 2). Runs before every capture (checkRelease) and every payout
// (checkPayout); pure apart from its reads, so a refusal happens before any PayPal call. Rules:
//   amount <= milestone amount, and fee + payout == amount;
//   payee == the agreed freelancer's current PayPal email (the one snapshotted at funding);
//   approver == the project's client;
//   the latest run has no FAIL, or the client wrote an override of at least 20 characters;
//   before a payout, the capture read back from PayPal is COMPLETED.
import { and, eq } from "drizzle-orm";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import type { Db } from "../db/types";
import { payments, projectMembers } from "../db/schema";
import { moneyToCents } from "../projects/money";
import { agreedPayeeEmail, livePayment, loadMilestone, milestoneForRole, type MilestoneContext, type PaymentRow } from "./context";

export type Verdict = "pass" | "fail" | "needs_review";
/** The latest verification run's verdicts for a milestone, or null if there is no report. Phase 6 plugs in Phase 4's latestVerdicts. */
export type LatestVerdicts = (milestoneId: string) => Promise<Verdict[] | null>;

export const OVERRIDE_MIN_CHARS = 20;
const AWAITING_APPROVAL = new Set(["REPORT_READY", "DISPUTED", "APPROVED"]);

export type GuardError =
  | "not_found"
  | "forbidden"
  | "not_releasable"
  | "not_funded"
  | "refund_needed"
  | "amount_exceeds_milestone"
  | "payee_changed"
  | "no_report"
  | "fail_without_override"
  | "override_too_short";

export type ReleasePlan = {
  milestone: MilestoneContext;
  payment: PaymentRow;
  amountCents: number;
  feeCents: number;
  payoutCents: number;
  payeeEmail: string;
  overrideReason: string | null;
  hasFail: boolean;
};

function checkAmounts(m: MilestoneContext, p: PaymentRow): { amountCents: number; feeCents: number; payoutCents: number } | null {
  if (p.fee === null || p.payoutAmount === null) return null;
  const amountCents = moneyToCents(p.amount);
  const feeCents = moneyToCents(p.fee);
  const payoutCents = moneyToCents(p.payoutAmount);
  if (amountCents > moneyToCents(m.amount) || feeCents + payoutCents !== amountCents || payoutCents <= 0) return null;
  return { amountCents, feeCents, payoutCents };
}

async function payeeUnchanged(db: Db, m: MilestoneContext, p: PaymentRow): Promise<boolean> {
  const payee = await agreedPayeeEmail(db, m.projectId);
  return Boolean(payee && p.payeeEmail && payee === p.payeeEmail);
}

export async function checkRelease(
  db: Db,
  args: { userId: string; milestoneId: string; overrideReason?: string; latestVerdicts: LatestVerdicts },
): Promise<Result<ReleasePlan, GuardError>> {
  const access = await milestoneForRole(db, { userId: args.userId, milestoneId: args.milestoneId, allowed: ["client"] });
  if (!access.ok) return access;
  const m = access.value.milestone;
  if (!AWAITING_APPROVAL.has(m.state)) return { ok: false, error: "not_releasable" };
  const p = await livePayment(db, m.id);
  if (!p?.authorizationId) return { ok: false, error: "not_funded" };
  if (p.status === "authorization_lost") return { ok: false, error: "refund_needed" };
  const amounts = checkAmounts(m, p);
  if (!amounts) return { ok: false, error: "amount_exceeds_milestone" };
  if (!(await payeeUnchanged(db, m, p))) return { ok: false, error: "payee_changed" };

  const verdicts = await args.latestVerdicts(m.id);
  if (!verdicts) return { ok: false, error: "no_report" };
  const hasFail = verdicts.includes("fail");
  const reason = args.overrideReason?.trim() ?? "";
  if (hasFail && !reason) return { ok: false, error: "fail_without_override" };
  if (hasFail && reason.length < OVERRIDE_MIN_CHARS) return { ok: false, error: "override_too_short" };
  return { ok: true, value: { milestone: m, payment: p, ...amounts, payeeEmail: p.payeeEmail!, overrideReason: hasFail ? reason : null, hasFail } };
}

/** Inside the approval transaction: the client's written reason for releasing despite a FAIL. */
export async function recordOverride(tx: Db, a: { projectId: string; userId: string; milestoneId: string; paymentId: string; reason: string }): Promise<void> {
  await appendAudit(tx, { projectId: a.projectId, actorId: a.userId, action: "override_recorded", data: { milestoneId: a.milestoneId, paymentId: a.paymentId, reason: a.reason } });
}

export type PayoutPlan = { payment: PaymentRow; milestone: MilestoneContext; payoutCents: number; payeeEmail: string };
export type PayoutGuardError = "not_found" | "not_releasable" | "capture_not_completed" | "amount_exceeds_milestone" | "payee_changed" | "approver_not_client";

/** Before a payout. `captureStatus` must come from a read-back of the capture from PayPal, not from a webhook body. */
export async function checkPayout(db: Db, args: { paymentId: string; captureStatus: string }): Promise<Result<PayoutPlan, PayoutGuardError>> {
  const [p] = await db.select().from(payments).where(eq(payments.id, args.paymentId));
  if (!p || p.supersededAt) return { ok: false, error: "not_found" };
  const m = await loadMilestone(db, p.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  if (m.state !== "RELEASED") return { ok: false, error: "not_releasable" };
  if (args.captureStatus !== "COMPLETED" || !p.captureId) return { ok: false, error: "capture_not_completed" };
  const amounts = checkAmounts(m, p);
  if (!amounts) return { ok: false, error: "amount_exceeds_milestone" };
  if (!(await payeeUnchanged(db, m, p))) return { ok: false, error: "payee_changed" };
  const [approver] = p.approvedBy
    ? await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, m.projectId), eq(projectMembers.userId, p.approvedBy), eq(projectMembers.role, "client")))
    : [];
  if (!approver) return { ok: false, error: "approver_not_client" };
  return { ok: true, value: { payment: p, milestone: m, payoutCents: amounts.payoutCents, payeeEmail: p.payeeEmail! } };
}
