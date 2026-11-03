// Server-side permission check. Reads project_members only; the role switcher cookie grants nothing.
// Demo users and real users are separate worlds: a membership across that line counts as none.
import { and, eq } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { projectMembers, projects, users } from "../db/schema";

export type ProjectRole = "client" | "freelancer";

export async function requireProjectRole(
  db: Db,
  args: { userId: string; projectId: string; allowed: readonly ProjectRole[] },
): Promise<Result<{ role: ProjectRole }, "not_member" | "forbidden">> {
  if (!parseId(args.projectId) || !parseId(args.userId)) return { ok: false, error: "not_member" };
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, args.projectId), eq(projectMembers.userId, args.userId), eq(users.isDemo, projects.isDemo)))
    .limit(1);
  if (!row) return { ok: false, error: "not_member" };
  if (!args.allowed.includes(row.role)) return { ok: false, error: "forbidden" };
  return { ok: true, value: { role: row.role } };
}
