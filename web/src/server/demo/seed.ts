// Demo data for judges: two seeded users who see only demo projects, and a Reset that restores the seed.
// Cached compiler outputs (produced by real Gemini calls, see scripts/warm-demo-cache.ts) are loaded into
// ai_cache, so the demo works instantly and spends no AI quota. Real users' rows are never touched.
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { AiUsage } from "../ai/structured-ai";
import { cacheKeyFor } from "../ai/structured-ai";
import { appendAudit } from "../audit/audit";
import { buildCompileRequest, checkCompilerOutput, compilerOutputSchema } from "../agreements/compiler";
import { applyCompileResult } from "../agreements/versions";
import type { Db } from "../db/types";
import * as s from "../db/schema";
import { createProject } from "../projects/projects";
import { DEMO_BRIEFS } from "./briefs";

export type DemoRole = "client" | "freelancer";
export type DemoCache = Record<string, { model: string; data: unknown; usage: AiUsage }>;

export const DEMO_USERS: Record<DemoRole, { githubId: string; login: string; name: string }> = {
  client: { githubId: "demo:client", login: "demo-client", name: "Dana (demo client)" },
  freelancer: { githubId: "demo:freelancer", login: "demo-freelancer", name: "Femi (demo freelancer)" },
};

const RESET_COOLDOWN_MS = 30_000;

async function lockDemo(tx: Db) {
  // One seeder or resetter at a time, even across instances.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('arbiter-demo'))`);
}

export async function demoUserId(db: Db, role: DemoRole): Promise<string | undefined> {
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.githubId, DEMO_USERS[role].githubId));
  return u?.id;
}

async function upsertDemoUsers(tx: Db): Promise<Record<DemoRole, string>> {
  const ids = {} as Record<DemoRole, string>;
  for (const role of ["client", "freelancer"] as const) {
    const u = DEMO_USERS[role];
    const [row] = await tx
      .insert(s.users)
      .values({ ...u, isDemo: true })
      .onConflictDoUpdate({ target: s.users.githubId, set: { name: u.name, login: u.login, isDemo: true } })
      .returning({ id: s.users.id });
    ids[role] = row!.id;
  }
  return ids;
}

async function loadCache(tx: Db, cache: DemoCache) {
  for (const [key, entry] of Object.entries(cache)) {
    if (!/^[0-9a-f]{64}$/.test(key)) continue;
    await tx.insert(s.aiCache).values({ key, model: entry.model, value: { data: entry.data, usage: entry.usage } }).onConflictDoNothing();
  }
}

async function createDemoProjects(tx: Db, ids: Record<DemoRole, string>, model: string, cache: DemoCache): Promise<string[]> {
  const created: string[] = [];
  for (const [i, b] of DEMO_BRIEFS.entries()) {
    const p = await createProject(tx, { userId: ids.client, title: b.title, brief: b.brief, budgetCents: b.budgetCents });
    if (!p.ok) throw new Error(`seed: could not create ${b.title}`);
    const projectId = p.value.projectId;
    created.push(projectId);
    await tx.insert(s.projectMembers).values({ projectId, userId: ids.freelancer, role: "freelancer" });
    await appendAudit(tx, { projectId, actorId: ids.freelancer, action: "invite_accepted", data: { seeded: true } });
    if (i !== 0) continue; // only TaskBoard starts compiled; Bakery is compiled by the judge (from the cache)
    const key = cacheKeyFor(model, buildCompileRequest({ brief: b.brief, budgetCents: b.budgetCents, answers: [] }));
    const entry = cache[key];
    const out = entry && entry.model === model ? compilerOutputSchema.safeParse(entry.data) : undefined;
    const body = out?.success ? checkCompilerOutput(out.data, b.budgetCents) : undefined;
    if (body?.ok) await applyCompileResult(tx, { projectId, userId: ids.client, body: body.value, jobId: null });
  }
  return created;
}

/** Idempotent: creates the demo users and, if no demo project exists, the two seed projects. */
export async function seedDemo(db: Db, args: { model: string; cache: DemoCache }): Promise<void> {
  await db.transaction(async (tx) => {
    await lockDemo(tx);
    const ids = await upsertDemoUsers(tx);
    await loadCache(tx, args.cache);
    const [any] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.isDemo, true)).limit(1);
    if (!any) await createDemoProjects(tx, ids, args.model, args.cache);
  });
}

async function deleteDemoProjects(tx: Db) {
  const P = tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.isDemo, true));
  const A = tx.select({ id: s.agreements.id }).from(s.agreements).where(inArray(s.agreements.projectId, P));
  const V = tx.select({ id: s.agreementVersions.id }).from(s.agreementVersions).where(inArray(s.agreementVersions.agreementId, A));
  const M = tx.select({ id: s.milestones.id }).from(s.milestones).where(inArray(s.milestones.agreementVersionId, V));
  const C = tx.select({ id: s.acceptanceCriteria.id }).from(s.acceptanceCriteria).where(inArray(s.acceptanceCriteria.milestoneId, M));
  const S = tx.select({ id: s.submissions.id }).from(s.submissions).where(inArray(s.submissions.milestoneId, M));
  const R = tx.select({ id: s.verificationRuns.id }).from(s.verificationRuns).where(inArray(s.verificationRuns.submissionId, S));
  const CR = tx.select({ id: s.checkResults.id }).from(s.checkResults).where(or(inArray(s.checkResults.runId, R), inArray(s.checkResults.criterionId, C)));
  // Children first, so no foreign key blocks a delete.
  await tx.delete(s.evidence).where(inArray(s.evidence.checkResultId, CR));
  await tx.delete(s.checkResults).where(or(inArray(s.checkResults.runId, R), inArray(s.checkResults.criterionId, C)));
  await tx.delete(s.verificationRuns).where(inArray(s.verificationRuns.submissionId, S));
  await tx.delete(s.submissions).where(inArray(s.submissions.milestoneId, M));
  await tx.delete(s.disputes).where(inArray(s.disputes.milestoneId, M));
  await tx.delete(s.payments).where(inArray(s.payments.milestoneId, M));
  await tx.delete(s.acceptanceCriteria).where(inArray(s.acceptanceCriteria.milestoneId, M));
  await tx.delete(s.milestones).where(inArray(s.milestones.agreementVersionId, V));
  await tx.delete(s.agreementVersions).where(inArray(s.agreementVersions.agreementId, A));
  await tx.delete(s.agreements).where(inArray(s.agreements.projectId, P));
  await tx.delete(s.compileJobs).where(inArray(s.compileJobs.projectId, P));
  await tx.delete(s.invitations).where(inArray(s.invitations.projectId, P));
  await tx.delete(s.auditEvents).where(inArray(s.auditEvents.projectId, P));
  await tx.delete(s.projectMembers).where(inArray(s.projectMembers.projectId, P));
  await tx.delete(s.projects).where(eq(s.projects.isDemo, true));
}

/** Demo users only, at most once per 30 s across all demo users (the demo is shared). */
export async function resetDemo(db: Db, args: { userId: string; model: string; cache: DemoCache }): Promise<Result<void, "not_demo" | "too_soon">> {
  if (!parseId(args.userId)) return { ok: false, error: "not_demo" };
  const [u] = await db.select({ isDemo: s.users.isDemo }).from(s.users).where(eq(s.users.id, args.userId));
  if (!u?.isDemo) return { ok: false, error: "not_demo" };
  return db.transaction(async (tx) => {
    await lockDemo(tx);
    const since = new Date(Date.now() - RESET_COOLDOWN_MS);
    const [recent] = await tx
      .select({ id: s.auditEvents.id })
      .from(s.auditEvents)
      .innerJoin(s.projects, eq(s.projects.id, s.auditEvents.projectId))
      .where(and(eq(s.projects.isDemo, true), eq(s.auditEvents.action, "demo_reset"), gt(s.auditEvents.createdAt, since)))
      .limit(1);
    if (recent) return { ok: false, error: "too_soon" } as const;
    await deleteDemoProjects(tx);
    const ids = await upsertDemoUsers(tx);
    await loadCache(tx, args.cache);
    const [first] = await createDemoProjects(tx, ids, args.model, args.cache);
    await appendAudit(tx, { projectId: first!, actorId: args.userId, action: "demo_reset", data: {} });
    return { ok: true, value: undefined } as const;
  });
}
