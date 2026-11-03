// Projects: created by a client, who becomes the project's first member. A project is a demo project
// exactly when its creator is a demo user.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Result } from "@/lib/result";
import { flagBrief } from "../agreements/brief-flags";
import { appendAudit } from "../audit/audit";
import type { Db } from "../db/types";
import { projectMembers, projects, users } from "../db/schema";
import { centsToMoney, moneyToCents } from "./money";

export const BUDGET_MIN_CENTS = 5_000;
export const BUDGET_MAX_CENTS = 500_000;

export const projectInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  brief: z.string().trim().min(40).max(4000),
  budgetCents: z.number().int().min(BUDGET_MIN_CENTS).max(BUDGET_MAX_CENTS),
});

export async function createProject(
  db: Db,
  args: { userId: string; title: string; brief: string; budgetCents: number },
): Promise<Result<{ projectId: string }, "invalid_input">> {
  const input = projectInputSchema.safeParse(args);
  if (!input.success) return { ok: false, error: "invalid_input" };
  const { title, brief, budgetCents } = input.data;
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ isDemo: users.isDemo }).from(users).where(eq(users.id, args.userId));
    if (!user) return { ok: false, error: "invalid_input" } as const;
    const [p] = await tx
      .insert(projects)
      .values({ title, brief, budget: centsToMoney(budgetCents), createdBy: args.userId, isDemo: user.isDemo, briefFlags: flagBrief(brief) })
      .returning({ id: projects.id });
    await tx.insert(projectMembers).values({ projectId: p!.id, userId: args.userId, role: "client" });
    // The brief itself stays out of the audit log; the version hash covers the agreement later.
    await appendAudit(tx, { projectId: p!.id, actorId: args.userId, action: "project_created", data: { title, budgetCents } });
    return { ok: true, value: { projectId: p!.id } } as const;
  });
}

export type ProjectListItem = { id: string; title: string; role: "client" | "freelancer"; budgetCents: number; isDemo: boolean; createdAt: Date };

export async function listProjectsForUser(db: Db, userId: string): Promise<ProjectListItem[]> {
  const rows = await db
    .select({ id: projects.id, title: projects.title, role: projectMembers.role, budget: projects.budget, isDemo: projects.isDemo, createdAt: projects.createdAt })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.userId, userId), eq(users.isDemo, projects.isDemo)))
    .orderBy(desc(projects.createdAt));
  return rows.map(({ budget, ...r }) => ({ ...r, budgetCents: moneyToCents(budget) }));
}
