// Shared reads for the payment flows: a milestone with its project, the caller's role, the live payment
// and the agreed payee. Every flow maps a non-member, a cross-tenant user and a malformed id to "not_found".
import { and, eq, isNull } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { requireProjectRole, type ProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { agreements, agreementVersions, milestones, payments, projectMembers, users } from "../db/schema";

export type MilestoneContext = typeof milestones.$inferSelect & { projectId: string };
export type PaymentRow = typeof payments.$inferSelect;

export async function loadMilestone(db: Db, milestoneId: string): Promise<MilestoneContext | null> {
  if (!parseId(milestoneId)) return null;
  const [row] = await db
    .select({ m: milestones, projectId: agreements.projectId })
    .from(milestones)
    .innerJoin(agreementVersions, eq(agreementVersions.id, milestones.agreementVersionId))
    .innerJoin(agreements, eq(agreements.id, agreementVersions.agreementId))
    .where(eq(milestones.id, milestoneId));
  return row ? { ...row.m, projectId: row.projectId } : null;
}

/** The milestone, if the user may act on it in one of the allowed roles. */
export async function milestoneForRole(
  db: Db,
  args: { userId: string; milestoneId: string; allowed: readonly ProjectRole[] },
): Promise<Result<{ milestone: MilestoneContext; role: ProjectRole }, "not_found" | "forbidden">> {
  const milestone = await loadMilestone(db, args.milestoneId);
  if (!milestone) return { ok: false, error: "not_found" };
  const role = await requireProjectRole(db, { userId: args.userId, projectId: milestone.projectId, allowed: args.allowed });
  if (!role.ok) return { ok: false, error: role.error === "forbidden" ? "forbidden" : "not_found" };
  return { ok: true, value: { milestone, role: role.value.role } };
}

export async function livePayment(db: Db, milestoneId: string): Promise<PaymentRow | null> {
  const [p] = await db.select().from(payments).where(and(eq(payments.milestoneId, milestoneId), isNull(payments.supersededAt)));
  return p ?? null;
}

/** The project freelancer's sandbox PayPal email, the payee the agreement pays. */
export async function agreedPayeeEmail(db: Db, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.paypalEmail })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "freelancer")));
  return row?.email ?? null;
}

/** Postgres unique violation (23505), whether or not the driver wrapped it. */
export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 5; cur = (cur as { cause?: unknown }).cause, i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
