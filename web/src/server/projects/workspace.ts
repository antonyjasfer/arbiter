// Read model for the project workspace and the dashboard. Everything goes through requireProjectRole,
// so a non-member, a cross-tenant user and a malformed id all get the same "not_found".
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { verifyChain, type ChainCheck } from "../audit/audit";
import { projectBadge, type Tone } from "@/lib/format";
import type { Result } from "@/lib/result";
import { z } from "zod";
import { agreementBodySchema, type AgreementBody } from "../agreements/body";
import { getCurrentVersion, type CurrentVersion } from "../agreements/versions";
import { requireProjectRole, type ProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { auditEvents, compileJobs, invitations, projectMembers, projects, users } from "../db/schema";
import { moneyToCents } from "./money";
import { listProjectsForUser } from "./projects";

const draftSchema = z.object({ draft: agreementBodySchema });

export type Workspace = {
  project: { id: string; title: string; brief: string; budgetCents: number; briefFlags: string[]; isDemo: boolean };
  role: ProjectRole;
  parties: { client: string; freelancer: string | null };
  version: CurrentVersion | null;
  job: { id: string; status: "queued" | "running" | "succeeded" | "failed"; errorCode: string | null; errorDetail: string | null } | null;
  hasOpenInvite: boolean;
  /** The AI draft kept on a job that failed the checks, for the client to fix by hand. */
  draft: AgreementBody | null;
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
    .select({ id: compileJobs.id, status: compileJobs.status, errorCode: compileJobs.errorCode, errorDetail: compileJobs.errorDetail, result: compileJobs.result })
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
      job: job ? { id: job.id, status: job.status, errorCode: job.errorCode, errorDetail: job.errorDetail } : null,
      hasOpenInvite: Boolean(invite),
      draft: job?.status === "failed" ? (draftSchema.safeParse(job.result).data?.draft ?? null) : null,
    },
  };
}

export async function getAuditTrail(
  db: Db,
  args: { userId: string; projectId: string },
): Promise<Result<{ title: string; chain: ChainCheck; events: { seq: number; action: string; actor: string | null; data: Record<string, unknown>; createdAt: Date; hash: string }[] }, "not_found">> {
  const role = await requireProjectRole(db, { ...args, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: "not_found" };
  const [p] = await db.select({ title: projects.title }).from(projects).where(eq(projects.id, args.projectId));
  const rows = await db
    .select({ seq: auditEvents.seq, action: auditEvents.action, name: users.name, login: users.login, data: auditEvents.data, createdAt: auditEvents.createdAt, hash: auditEvents.hash })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(eq(auditEvents.projectId, args.projectId))
    .orderBy(asc(auditEvents.seq));
  return {
    ok: true,
    value: {
      title: p!.title,
      chain: await verifyChain(db, args.projectId),
      events: rows.map(({ name, login, data, ...r }) => ({ ...r, actor: name ?? login ?? null, data: (data ?? {}) as Record<string, unknown> })),
    },
  };
}

export type ProjectSummary ={ id: string; title: string; role: ProjectRole; budgetCents: number; badge: { label: string; tone: Tone } };

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
