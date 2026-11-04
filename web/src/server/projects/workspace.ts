// Read model for the project workspace and the dashboard. Everything goes through requireProjectRole,
// so a non-member, a cross-tenant user and a malformed id all get the same "not_found".
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { projectBadge, type Tone } from "@/lib/format";
import type { Result } from "@/lib/result";
import { getCurrentVersion, type CurrentVersion } from "../agreements/versions";
import { requireProjectRole, type ProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { compileJobs, invitations, projectMembers, projects, users } from "../db/schema";
import { moneyToCents } from "./money";
import { listProjectsForUser } from "./projects";

export type Workspace = {
  project: { id: string; title: string; brief: string; budgetCents: number; briefFlags: string[]; isDemo: boolean };
  role: ProjectRole;
  parties: { client: string; freelancer: string | null };
  version: CurrentVersion | null;
  job: { id: string; status: "queued" | "running" | "succeeded" | "failed"; errorCode: string | null; errorDetail: string | null } | null;
  hasOpenInvite: boolean;
};

export async function getWorkspace(db: Db, args: { userId: string; projectId: string }): Promise<Result<Workspace, "not_found">> {
  const role = await requireProjectRole(db, { ...args, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: "not_found" };
  const [p] = await db.select().from(projects).where(eq(projects.id, args.projectId));
  const members = await db
    .select({ role: projectMembers.role, name: users.name, login: users.login })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, args.projectId));
  const nameOf = (r: ProjectRole) => {
    const m = members.find((x) => x.role === r);
    return m ? (m.name ?? m.login) : null;
  };
  const v = await getCurrentVersion(db, args);
  const [job] = await db
    .select({ id: compileJobs.id, status: compileJobs.status, errorCode: compileJobs.errorCode, errorDetail: compileJobs.errorDetail })
    .from(compileJobs)
    .where(eq(compileJobs.projectId, args.projectId))
    .orderBy(desc(compileJobs.createdAt))
    .limit(1);
  const [invite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.projectId, args.projectId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  return {
    ok: true,
    value: {
      project: { id: p!.id, title: p!.title, brief: p!.brief, budgetCents: moneyToCents(p!.budget), briefFlags: p!.briefFlags, isDemo: p!.isDemo },
      role: role.value.role,
      parties: { client: nameOf("client") ?? "Client", freelancer: nameOf("freelancer") },
      version: v.ok ? v.value : null,
      job: job ?? null,
      hasOpenInvite: Boolean(invite),
    },
  };
}

export type ProjectSummary = { id: string; title: string; role: ProjectRole; budgetCents: number; badge: { label: string; tone: Tone } };

export async function listProjectsWithStatus(db: Db, userId: string): Promise<ProjectSummary[]> {
  const list = await listProjectsForUser(db, userId);
  return Promise.all(
    list.map(async (p) => {
      const v = await getCurrentVersion(db, { userId, projectId: p.id });
      const cur = v.ok ? v.value : null;
      const mine = p.role === "client" ? cur?.clientApprovedAt : cur?.freelancerApprovedAt;
      const theirs = p.role === "client" ? cur?.freelancerApprovedAt : cur?.clientApprovedAt;
      return {
        id: p.id,
        title: p.title,
        role: p.role,
        budgetCents: p.budgetCents,
        badge: projectBadge({ hasVersion: Boolean(cur), locked: Boolean(cur?.locked), role: p.role, mine: Boolean(mine), theirs: Boolean(theirs) }),
      };
    }),
  );
}
