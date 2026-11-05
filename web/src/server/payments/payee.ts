// The freelancer's sandbox PayPal email: where payouts go. Each payment snapshots it when funding starts
// (funding.ts), and the payment guard refuses a release if it changed afterwards. Demo users keep the
// seeded email. The audit records that it changed, never the value (both parties read the audit log).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import type { Db } from "../db/types";
import { projectMembers, projects, users } from "../db/schema";

const emailSchema = z.string().trim().pipe(z.email().max(254));

export async function getPaypalEmail(db: Db, userId: string): Promise<{ email: string | null; isDemo: boolean } | null> {
  const [u] = await db.select({ email: users.paypalEmail, isDemo: users.isDemo }).from(users).where(eq(users.id, userId));
  return u ?? null;
}

export async function setPaypalEmail(db: Db, args: { userId: string; email: string }): Promise<Result<undefined, "invalid_email" | "demo_locked" | "not_found">> {
  const parsed = emailSchema.safeParse(args.email);
  if (!parsed.success) return { ok: false, error: "invalid_email" };
  const email = parsed.data;
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ email: users.paypalEmail, isDemo: users.isDemo }).from(users).where(eq(users.id, args.userId)).for("update");
    if (!u) return { ok: false, error: "not_found" } as const;
    if (u.isDemo) return { ok: false, error: "demo_locked" } as const;
    if (u.email === email) return { ok: true, value: undefined } as const;
    await tx.update(users).set({ paypalEmail: email }).where(eq(users.id, args.userId));
    const mine = await tx
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, args.userId), eq(projectMembers.role, "freelancer"), eq(projects.isDemo, false)));
    for (const p of mine) {
      await appendAudit(tx, { projectId: p.projectId, actorId: args.userId, action: "paypal_email_set", data: { role: "freelancer", hadEmail: u.email !== null } });
    }
    return { ok: true, value: undefined } as const;
  });
}
