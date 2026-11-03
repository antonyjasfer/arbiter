import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import type { AiFailure, AiRequest, AiSuccess, StructuredAi } from "../ai/structured-ai";
import { cacheKeyFor } from "../ai/structured-ai";
import { dbCacheStore } from "../ai/db-cache";
import { verifyChain } from "../audit/audit";
import { createProject } from "../projects/projects";
import { acceptInvite, createInvite } from "../projects/invitations";
import { buildCompileRequest, type CompilerOutput } from "./compiler";
import { claimJob, getJobStatus, resumeDueJobs, runJob, startCompile } from "./compile-jobs";

const db = setupTestDb();
const brief = "A small task-list web app with add, complete and filter, and a health check.";
const T0 = new Date("2026-11-04T06:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
let client: string, freelancer: string, outsider: string, demoClient: string, projectId: string, demoProjectId: string;

const good: CompilerOutput = {
  milestones: [
    { title: "Working app", amount_cents: 15000, due_in_days: 7, criteria: [{ kind: "test", text: "npm test passes." }] },
    { title: "Filters", amount_cents: 15000, due_in_days: 14, criteria: [{ kind: "browser", text: "Active hides completed tasks." }] },
  ],
  questions: [],
};
const busy: AiFailure = { ok: false, reason: "busy", detail: "429" };
const usage = { inputTokens: 1, outputTokens: 1 };

function fakeAi(...replies: (CompilerOutput | AiFailure)[]): StructuredAi & { calls: number } {
  const ai = {
    model: "fake-model",
    calls: 0,
    async generate<T>(_req: AiRequest<T>): Promise<AiSuccess<T> | AiFailure> {
      const r = replies[Math.min(ai.calls++, replies.length - 1)]!;
      return "ok" in r ? r : ({ ok: true, data: r as unknown as T, model: "fake-model", cached: false, usage } as AiSuccess<T>);
    },
  };
  return ai;
}

beforeEach(async () => {
  const users = await db()
    .insert(s.users)
    .values([
      { githubId: "1", login: "client" },
      { githubId: "2", login: "freelancer" },
      { githubId: "3", login: "outsider" },
      { githubId: "demo:client", login: "dc", isDemo: true },
    ])
    .returning();
  [client, freelancer, outsider, demoClient] = users.map((u) => u.id) as [string, string, string, string];
  const p = await createProject(db(), { userId: client, title: "TaskBoard", brief, budgetCents: 30000 });
  const d = await createProject(db(), { userId: demoClient, title: "Demo", brief, budgetCents: 30000 });
  if (!p.ok || !d.ok) throw new Error("setup");
  projectId = p.value.projectId;
  demoProjectId = d.value.projectId;
  const inv = await createInvite(db(), { userId: client, projectId });
  if (inv.ok) await acceptInvite(db(), { userId: freelancer, token: inv.value.token });
});

async function start(userId = client, pid = projectId, now = T0, model = "fake-model") {
  const r = await startCompile(db(), { userId, projectId: pid, now, model });
  if (!r.ok) throw new Error(r.error);
  return r.value.jobId;
}

async function job(id: string) {
  const [j] = await db().select().from(s.compileJobs).where(eq(s.compileJobs.id, id));
  return j!;
}

describe("compile job lifecycle", () => {
  it("succeeds: version 1 exists and the audit has compile_started, version_created, compile_finished", async () => {
    const jobId = await start();
    await runJob(db(), fakeAi(good), jobId, () => at(1));
    expect(await job(jobId)).toMatchObject({ status: "succeeded", attempts: 1, live: true, errorCode: null });
    const [v] = await db().select().from(s.agreementVersions);
    expect(v).toMatchObject({ version: 1, source: "ai", compileJobId: jobId });
    const actions = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId)).orderBy(s.auditEvents.seq)).map((e) => e.action);
    expect(actions.slice(-3)).toEqual(["compile_started", "version_created", "compile_finished"]);
    expect(await verifyChain(db(), projectId)).toMatchObject({ ok: true });
  });

  it("lets exactly one of two simultaneous claims win", async () => {
    const jobId = await start();
    const [a, b] = await Promise.all([claimJob(db(), jobId, at(1)), claimJob(db(), jobId, at(1))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("resumes a running job whose lease expired (the server restarted mid-call)", async () => {
    const jobId = await start();
    expect(await claimJob(db(), jobId, at(1))).toBeTruthy(); // claimed, then the process died
    await resumeDueJobs(db(), fakeAi(good), at(60)); // lease (150 s) still held: nothing happens
    expect(await job(jobId)).toMatchObject({ status: "running", attempts: 1 });
    await resumeDueJobs(db(), fakeAi(good), at(200));
    expect(await job(jobId)).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  it("does not let a runner whose lease was taken over overwrite the newer attempt", async () => {
    const jobId = await start();
    // While runner 1 waits on the model, its lease expires and another instance claims the job.
    const slow: StructuredAi = {
      model: "fake-model",
      async generate<T>() {
        await claimJob(db(), jobId, at(200));
        return { ok: true, data: good as unknown as T, model: "fake-model", cached: false, usage } as AiSuccess<T>;
      },
    };
    await runJob(db(), slow, jobId, () => at(1));
    expect(await job(jobId)).toMatchObject({ status: "running", attempts: 2 });
    expect(await db().select().from(s.agreementVersions)).toEqual([]);
  });

  it("backs off when the AI is busy, then fails with ai_busy after 4 attempts", async () => {
    const ai = fakeAi(busy);
    const jobId = await start();
    await runJob(db(), ai, jobId, () => at(1));
    expect(await job(jobId)).toMatchObject({ status: "queued", attempts: 1, errorCode: "ai_busy", nextAttemptAt: at(21) });
    await resumeDueJobs(db(), ai, at(10)); // not due yet
    expect((await job(jobId)).attempts).toBe(1);
    await resumeDueJobs(db(), ai, at(21));
    expect(await job(jobId)).toMatchObject({ status: "queued", attempts: 2, nextAttemptAt: at(81) });
    await resumeDueJobs(db(), ai, at(81));
    expect(await job(jobId)).toMatchObject({ status: "queued", attempts: 3, nextAttemptAt: at(201) });
    await resumeDueJobs(db(), ai, at(201));
    expect(await job(jobId)).toMatchObject({ status: "failed", attempts: 4, errorCode: "ai_busy" });
    const last = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId)).orderBy(s.auditEvents.seq)).at(-1);
    expect(last).toMatchObject({ action: "compile_failed", data: { jobId, code: "ai_busy" } });
  });

  it("fails with checks_failed and the reason when the amounts do not add up", async () => {
    const jobId = await start();
    const wrong = { ...good, milestones: [{ ...good.milestones[0]!, amount_cents: 20000 }, good.milestones[1]!] };
    await runJob(db(), fakeAi(wrong), jobId, () => at(1));
    const j = await job(jobId);
    expect(j).toMatchObject({ status: "failed", errorCode: "checks_failed" });
    expect(JSON.parse(j.errorDetail!)).toEqual([{ code: "sum_mismatch" }]);
    expect(await db().select().from(s.agreementVersions)).toEqual([]);
  });

  it("serves a cached result without counting it as live", async () => {
    const req = buildCompileRequest({ brief, budgetCents: 30000, answers: [] });
    await dbCacheStore(db(), "fake-model").set(cacheKeyFor("fake-model", req), JSON.stringify({ data: good, usage }));
    const ai = fakeAi(busy);
    const jobId = await start();
    await runJob(db(), ai, jobId, () => at(1));
    expect(await job(jobId)).toMatchObject({ status: "succeeded", live: false });
    expect(ai.calls).toBe(0);
  });
});

describe("startCompile guards", () => {
  it("allows one active job per project and only the client may start one", async () => {
    await start();
    expect(await startCompile(db(), { userId: client, projectId, now: T0, model: "fake-model" })).toEqual({ ok: false, error: "job_running" });
    expect(await startCompile(db(), { userId: freelancer, projectId, now: T0, model: "fake-model" })).toEqual({ ok: false, error: "forbidden" });
    expect(await startCompile(db(), { userId: outsider, projectId, now: T0, model: "fake-model" })).toEqual({ ok: false, error: "not_member" });
  });

  it("caps a real user at 10 live compiles per UTC day, except for cache hits", async () => {
    const other = await createProject(db(), { userId: client, title: "Other", brief, budgetCents: 30000 });
    if (!other.ok) throw new Error("setup");
    await db().insert(s.compileJobs).values(
      Array.from({ length: 10 }, () => ({ projectId: other.value.projectId, requestedBy: client, status: "succeeded" as const, input: {}, live: true, createdAt: at(-3600) })),
    );
    expect(await startCompile(db(), { userId: client, projectId, now: T0, model: "fake-model" })).toEqual({ ok: false, error: "daily_cap" });
    // A cache hit is still allowed.
    const req = buildCompileRequest({ brief, budgetCents: 30000, answers: [] });
    await dbCacheStore(db(), "fake-model").set(cacheKeyFor("fake-model", req), JSON.stringify({ data: good, usage }));
    expect((await startCompile(db(), { userId: client, projectId, now: T0, model: "fake-model" })).ok).toBe(true);
  });

  it("resets the real-user cap at 00:00 UTC (05:30 IST)", async () => {
    await db().insert(s.compileJobs).values(
      Array.from({ length: 10 }, () => ({ projectId, requestedBy: client, status: "succeeded" as const, input: {}, live: true, createdAt: at(-3600) })),
    );
    expect(await startCompile(db(), { userId: client, projectId, now: new Date("2026-11-05T00:00:01Z"), model: "fake-model" })).toMatchObject({ ok: true });
  });

  it("caps all demo users together at 20 live compiles per UTC day", async () => {
    await db().insert(s.compileJobs).values(
      Array.from({ length: 20 }, () => ({ projectId: demoProjectId, requestedBy: demoClient, status: "succeeded" as const, input: {}, live: true, createdAt: at(-60) })),
    );
    expect(await startCompile(db(), { userId: demoClient, projectId: demoProjectId, now: T0, model: "fake-model" })).toEqual({ ok: false, error: "demo_cap" });
  });

  it("refuses a compile once the agreement is locked", async () => {
    const jobId = await start();
    await runJob(db(), fakeAi(good), jobId, () => at(1));
    await db().update(s.agreements).set({ status: "locked" }).where(eq(s.agreements.projectId, projectId));
    expect(await startCompile(db(), { userId: client, projectId, now: at(5), model: "fake-model" })).toEqual({ ok: false, error: "locked" });
  });
});

describe("getJobStatus", () => {
  it("shows a job to project members only, and treats a bad id as not found", async () => {
    const jobId = await start();
    expect(await getJobStatus(db(), { userId: freelancer, jobId })).toMatchObject({ ok: true, value: { status: "queued" } });
    expect(await getJobStatus(db(), { userId: outsider, jobId })).toEqual({ ok: false, error: "not_found" });
    expect(await getJobStatus(db(), { userId: demoClient, jobId })).toEqual({ ok: false, error: "not_found" });
    expect(await getJobStatus(db(), { userId: client, jobId: "../../etc" })).toEqual({ ok: false, error: "not_found" });
  });
});
