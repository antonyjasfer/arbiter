// Demo data for judges: two seeded users who see only demo projects, and a Reset that restores the seed.
// Cached compiler outputs (produced by real Gemini calls, see scripts/warm-demo-cache.ts) are loaded into
// ai_cache, so the demo works instantly and spends no AI quota. Real users' rows are never touched.
import { and, eq, gt, inArray, notInArray, or, sql } from "drizzle-orm";
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

async function upsertDemoUsers(tx: Db, freelancerPaypalEmail?: string): Promise<Record<DemoRole, string>> {
  const ids = {} as Record<DemoRole, string>;
  for (const role of ["client", "freelancer"] as const) {
    const u = DEMO_USERS[role];
    // The demo freelancer is paid at the sandbox email from PAYPAL_FREELANCER_EMAIL (Phase 5); a seed without one keeps it.
    const paypal = role === "freelancer" && freelancerPaypalEmail ? { paypalEmail: freelancerPaypalEmail } : {};
    const [row] = await tx
      .insert(s.users)
      .values({ ...u, ...paypal, isDemo: true })
      .onConflictDoUpdate({ target: s.users.githubId, set: { name: u.name, login: u.login, isDemo: true, ...paypal } })
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
export async function seedDemo(db: Db, args: { model: string; cache: DemoCache; freelancerPaypalEmail?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await lockDemo(tx);
    const ids = await upsertDemoUsers(tx, args.freelancerPaypalEmail);
    await loadCache(tx, args.cache);
    const [any] = await tx.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.isDemo, true)).limit(1);
    if (!any) await createDemoProjects(tx, ids, args.model, args.cache);
  });
}

// Reset keeps every demo project that has a live PayPal payment: real sandbox money was authorized, captured
// or paid out there, and its rows and audit chain are the record of it. A fresh order_pending is kept too,
// because the buyer may still be approving in the PayPal popup. Kept projects are listed in their own
// section of the dashboard, below the fresh seed projects.
const ORDER_PENDING_GRACE_MS = 24 * 3_600_000;

export function isKeptPayment(p: { status: string; createdAt: Date }, now: Date): boolean {
  if (p.status === "voided" || p.status === "authorization_lost") return false;
  if (p.status === "order_pending") return now.getTime() - p.createdAt.getTime() <= ORDER_PENDING_GRACE_MS;
  return true;
}

function demoPaymentsQuery(db: Db) {
  return db
    .select({ projectId: s.agreements.projectId, status: s.payments.status, createdAt: s.payments.createdAt })
    .from(s.payments)
    .innerJoin(s.milestones, eq(s.milestones.id, s.payments.milestoneId))
    .innerJoin(s.agreementVersions, eq(s.agreementVersions.id, s.milestones.agreementVersionId))
    .innerJoin(s.agreements, eq(s.agreements.id, s.agreementVersions.agreementId))
    .innerJoin(s.projects, eq(s.projects.id, s.agreements.projectId))
    .where(eq(s.projects.isDemo, true));
}

function keptFrom(rows: { projectId: string; status: string; createdAt: Date }[], now: Date): Set<string> {
  return new Set(rows.filter((r) => isKeptPayment(r, now)).map((r) => r.projectId));
}

/** Demo projects that Reset demo keeps (they have a live PayPal payment). */
export async function keptDemoProjectIds(db: Db, now = new Date()): Promise<Set<string>> {
  return keptFrom(await demoPaymentsQuery(db), now);
}

async function deleteDemoProjects(tx: Db, kept: string[]) {
  const P = tx
    .select({ id: s.projects.id })
    .from(s.projects)
    .where(kept.length ? and(eq(s.projects.isDemo, true), notInArray(s.projects.id, kept)) : eq(s.projects.isDemo, true));
  const A = tx.select({ id: s.agreements.id }).from(s.agreements).where(inArray(s.agreements.projectId, P));
  const V = tx.select({ id: s.agreementVersions.id }).from(s.agreementVersions).where(inArray(s.agreementVersions.agreementId, A));
  const M = tx.select({ id: s.milestones.id }).from(s.milestones).where(inArray(s.milestones.agreementVersionId, V));
  const C = tx.select({ id: s.acceptanceCriteria.id }).from(s.acceptanceCriteria).where(inArray(s.acceptanceCriteria.milestoneId, M));
  const S = tx.select({ id: s.submissions.id }).from(s.submissions).where(inArray(s.submissions.milestoneId, M));
  const R = tx.select({ id: s.verificationRuns.id }).from(s.verificationRuns).where(inArray(s.verificationRuns.submissionId, S));
  const CR = tx.select({ id: s.checkResults.id }).from(s.checkResults).where(or(inArray(s.checkResults.runId, R), inArray(s.checkResults.criterionId, C)));
  // Children first, so no foreign key blocks a delete.
  await tx.delete(s.evidence).where(or(inArray(s.evidence.checkResultId, CR), inArray(s.evidence.runId, R)));
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
  await tx.delete(s.projects).where(inArray(s.projects.id, P));
}

/** Demo users only, at most once per 30 s across all demo users (the demo is shared). */
export async function resetDemo(db: Db, args: { userId: string; model: string; cache: DemoCache; freelancerPaypalEmail?: string }): Promise<Result<void, "not_demo" | "too_soon">> {
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
    // Lock every demo milestone and payment before deciding what to keep, so a funding or capture that is
    // running right now either finished first (and is kept) or waits and then fails on the deleted milestone
    // before any PayPal call (funding inserts its payment row before create-order).
    await tx
      .select({ id: s.milestones.id })
      .from(s.milestones)
      .innerJoin(s.agreementVersions, eq(s.agreementVersions.id, s.milestones.agreementVersionId))
      .innerJoin(s.agreements, eq(s.agreements.id, s.agreementVersions.agreementId))
      .innerJoin(s.projects, eq(s.projects.id, s.agreements.projectId))
      .where(eq(s.projects.isDemo, true))
      .for("update", { of: s.milestones });
    const kept = [...keptFrom(await demoPaymentsQuery(tx).for("update", { of: s.payments }), new Date())];
    await deleteDemoProjects(tx, kept);
    const ids = await upsertDemoUsers(tx, args.freelancerPaypalEmail);
    await loadCache(tx, args.cache);
    const [first] = await createDemoProjects(tx, ids, args.model, args.cache);
    await appendAudit(tx, { projectId: first!, actorId: args.userId, action: "demo_reset", data: { kept: kept.length } });
    return { ok: true, value: undefined } as const;
  });
}
