// Server-side permission check. Reads project_members only; the role switcher cookie grants nothing.
import { and, eq } from "drizzle-orm";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { projectMembers } from "../db/schema";

export type ProjectRole = "client" | "freelancer";

export async function requireProjectRole(
  db: Db,
  args: { userId: string; projectId: string; allowed: readonly ProjectRole[] },
): Promise<Result<{ role: ProjectRole }, "not_member" | "forbidden">> {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, args.projectId), eq(projectMembers.userId, args.userId)))
    .limit(1);
  if (!row) return { ok: false, error: "not_member" };
  if (!args.allowed.includes(row.role)) return { ok: false, error: "forbidden" };
  return { ok: true, value: { role: row.role } };
}
