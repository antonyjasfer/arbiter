// Agreement Compiler jobs, persisted in compile_jobs so a restart or cold start never loses one.
// A job is claimed with one guarded UPDATE that takes a 150 s lease and bumps `attempts`; `attempts`
// is the fencing token, so a runner whose lease was taken over cannot write its result.
// Nothing here uses in-process timers: due jobs are resumed on boot and on every status poll.
import { and, count, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { cacheKeyFor, withCache, type StructuredAi } from "../ai/structured-ai";
import { dbCacheStore } from "../ai/db-cache";
import { appendAudit } from "../audit/audit";
import { requireProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { agreements, compileJobs, projects, users } from "../db/schema";
import { moneyToCents } from "../projects/money";
import { buildCompileRequest, checkCompilerOutput, draftBody, type CompileInput } from "./compiler";
import { applyCompileResult } from "./versions";

export const LEASE_MS = 150_000;
export const BUSY_BACKOFF_MS = [20_000, 60_000, 120_000] as const;
export const MAX_ATTEMPTS = BUSY_BACKOFF_MS.length + 1;
export const REAL_DAILY_CAP = 10; // user decision, 3 Nov 2026
export const DEMO_DAILY_CAP = 20;

type Job = typeof compileJobs.$inferSelect;
export type StartError = "not_member" | "forbidden" | "job_running" | "locked" | "demo_cap" | "daily_cap";

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function startCompile(
  db: Db,
  args: { userId: string; projectId: string; answers?: CompileInput["answers"]; now?: Date; model: string },
): Promise<Result<{ jobId: string }, StartError>> {
  const role = await requireProjectRole(db, { userId: args.userId, projectId: args.projectId, allowed: ["client"] });
  if (!role.ok) return role;
  const now = args.now ?? new Date();
  const [p] = await db.select({ brief: projects.brief, budget: projects.budget, isDemo: projects.isDemo }).from(projects).where(eq(projects.id, args.projectId));
  const input: CompileInput = { brief: p!.brief, budgetCents: moneyToCents(p!.budget), answers: args.answers ?? [] };

  // Caps count live (uncached) model calls only; a request the cache can answer is always allowed.
  const cached = await dbCacheStore(db, args.model).get(cacheKeyFor(args.model, buildCompileRequest(input)));
  if (cached === undefined) {
    const since = startOfUtcDay(now);
    const liveToday = and(eq(compileJobs.live, true), gte(compileJobs.createdAt, since));
    const [row] = p!.isDemo
      ? await db.select({ n: count() }).from(compileJobs).innerJoin(users, eq(users.id, compileJobs.requestedBy)).where(and(liveToday, eq(users.isDemo, true)))
      : await db.select({ n: count() }).from(compileJobs).where(and(liveToday, eq(compileJobs.requestedBy, args.userId)));
    const n = row?.n ?? 0;
    if (p!.isDemo && n >= DEMO_DAILY_CAP) return { ok: false, error: "demo_cap" };
    if (!p!.isDemo && n >= REAL_DAILY_CAP) return { ok: false, error: "daily_cap" };
  }

  return db.transaction(async (tx) => {
    // Serialise starts per project on the project row (the audit append below locks it too).
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, args.projectId)).for("update");
    const [a] = await tx.select({ status: agreements.status }).from(agreements).where(eq(agreements.projectId, args.projectId));
    if (a?.status === "locked") return { ok: false, error: "locked" } as const;
    const [active] = await tx
      .select({ id: compileJobs.id })
      .from(compileJobs)
      .where(and(eq(compileJobs.projectId, args.projectId), inArray(compileJobs.status, ["queued", "running"])));
    if (active) return { ok: false, error: "job_running" } as const;
    const [j] = await tx
      .insert(compileJobs)
      .values({ projectId: args.projectId, requestedBy: args.userId, input, nextAttemptAt: now, createdAt: now })
      .returning({ id: compileJobs.id });
    await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "compile_started", data: { jobId: j!.id, answers: input.answers.length } });
    return { ok: true, value: { jobId: j!.id } } as const;
  });
}

export async function claimJob(db: Db, jobId: string, now: Date): Promise<Job | undefined> {
  const [j] = await db
    .update(compileJobs)
    .set({ status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${compileJobs.attempts} + 1` })
    .where(
      and(
        eq(compileJobs.id, jobId),
        or(and(eq(compileJobs.status, "queued"), lte(compileJobs.nextAttemptAt, now)), and(eq(compileJobs.status, "running"), lt(compileJobs.leaseUntil, now))),
      ),
    )
    .returning();
  return j;
}

/** Only the holder of attempt `attempts` may write; anything else is a stale runner. */
function mine(job: Job) {
  return and(eq(compileJobs.id, job.id), eq(compileJobs.status, "running"), eq(compileJobs.attempts, job.attempts));
}

async function fail(db: Db, job: Job, code: "ai_busy" | "invalid_output" | "checks_failed" | "error", detail: string, now: Date, result?: unknown) {
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(compileJobs)
      .set({ status: "failed", errorCode: code, errorDetail: detail.slice(0, 2000), leaseUntil: null, finishedAt: now, result: result ?? null })
      .where(mine(job))
      .returning({ id: compileJobs.id });
    if (done) await appendAudit(tx, { projectId: job.projectId, actorId: null, action: "compile_failed", data: { jobId: job.id, code } });
  });
}

export async function runJob(db: Db, ai: StructuredAi, jobId: string, clock: () => Date = () => new Date()): Promise<void> {
  const job = await claimJob(db, jobId, clock());
  if (!job) return;
  const input = job.input as CompileInput;
  const req = buildCompileRequest(input);
  const store = dbCacheStore(db, ai.model);
  // Mark the job live before an uncached call, so the daily caps count it even if the call fails.
  if ((await store.get(cacheKeyFor(ai.model, req))) === undefined) {
    await db.update(compileJobs).set({ live: true }).where(mine(job));
  }
  const res = await withCache(ai, store).generate(req);
  const now = clock();

  if (!res.ok) {
    if ((res.reason === "busy" || res.reason === "error") && job.attempts < MAX_ATTEMPTS) {
      const delay = res.retryAfterMs ?? BUSY_BACKOFF_MS[job.attempts - 1]!;
      await db
        .update(compileJobs)
        .set({ status: "queued", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + Math.max(delay, BUSY_BACKOFF_MS[job.attempts - 1]!)), errorCode: res.reason === "busy" ? "ai_busy" : "error", errorDetail: null })
        .where(mine(job));
      return;
    }
    const code = res.reason === "busy" ? "ai_busy" : res.reason === "invalid_output" ? "invalid_output" : "error";
    await fail(db, job, code, res.detail, now);
    return;
  }

  const checked = checkCompilerOutput(res.data, input.budgetCents);
  if (!checked.ok) {
    await fail(db, job, "checks_failed", JSON.stringify(checked.error), now, { draft: draftBody(res.data) });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [held] = await tx.select({ id: compileJobs.id }).from(compileJobs).where(mine(job)).for("update");
      if (!held) return; // lease was taken over; the newer attempt will write
      const v = await applyCompileResult(tx, { projectId: job.projectId, userId: job.requestedBy, body: checked.value, jobId: job.id });
      await tx
        .update(compileJobs)
        .set({ status: "succeeded", result: { version: v.version, hash: v.hash, cached: res.cached }, errorCode: null, errorDetail: null, leaseUntil: null, finishedAt: now })
        .where(mine(job));
      await appendAudit(tx, { projectId: job.projectId, actorId: null, action: "compile_finished", data: { jobId: job.id, version: v.version, cached: res.cached } });
    });
  } catch (e) {
    await fail(db, job, "error", e instanceof Error ? e.message : String(e), now);
  }
}

/** Runs every job that is due (queued and past its backoff, or running with an expired lease). */
export async function resumeDueJobs(db: Db, ai: StructuredAi, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: compileJobs.id })
    .from(compileJobs)
    .where(or(and(eq(compileJobs.status, "queued"), lte(compileJobs.nextAttemptAt, now)), and(eq(compileJobs.status, "running"), lt(compileJobs.leaseUntil, now))))
    .limit(5);
  for (const { id } of due) await runJob(db, ai, id, () => now);
  return due.length;
}

export type JobStatus = Pick<Job, "id" | "projectId" | "status" | "attempts" | "nextAttemptAt" | "errorCode" | "errorDetail" | "result" | "live">;

export async function getJobStatus(db: Db, args: { userId: string; jobId: string }): Promise<Result<JobStatus, "not_found">> {
  if (!parseId(args.jobId)) return { ok: false, error: "not_found" };
  const [j] = await db.select().from(compileJobs).where(eq(compileJobs.id, args.jobId));
  if (!j) return { ok: false, error: "not_found" };
  const role = await requireProjectRole(db, { userId: args.userId, projectId: j.projectId, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: "not_found" };
  const { id, projectId, status, attempts, nextAttemptAt, errorCode, errorDetail, result, live } = j;
  return { ok: true, value: { id, projectId, status, attempts, nextAttemptAt, errorCode, errorDetail, result, live } };
}
