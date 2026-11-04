import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { cacheKeyFor } from "../ai/structured-ai";
import { verifyChain } from "../audit/audit";
import { buildCompileRequest, type CompilerOutput } from "../agreements/compiler";
import { getCurrentVersion } from "../agreements/versions";
import { createProject, listProjectsForUser } from "../projects/projects";
import { DEMO_BRIEFS } from "./briefs";
import { demoUserId, resetDemo, seedDemo, type DemoCache } from "./seed";

const db = setupTestDb();
const MODEL = "gemini-test";

const taskboardOutput: CompilerOutput = {
  milestones: [
    { title: "Working app, deployed", amount_cents: 15000, due_in_days: 7, criteria: [{ kind: "browser", text: 'Adding "Buy milk" shows it.' }, { kind: "review", text: "Easy to use." }] },
    { title: "Filters, validation and README", amount_cents: 15000, due_in_days: 14, criteria: [{ kind: "static", text: "README explains how to run it." }] },
  ],
  questions: [],
};

function fixture(): DemoCache {
  const tb = DEMO_BRIEFS[0];
  const key = cacheKeyFor(MODEL, buildCompileRequest({ brief: tb.brief, budgetCents: tb.budgetCents, answers: [] }));
  return { [key]: { model: MODEL, data: taskboardOutput, usage: { inputTokens: 1, outputTokens: 1 } } };
}

async function demoProjects() {
  return db().select().from(s.projects).where(eq(s.projects.isDemo, true)).orderBy(s.projects.title);
}

let realUser: string;
beforeEach(async () => {
  const [u] = await db().insert(s.users).values({ githubId: "1", login: "real" }).returning();
  realUser = u!.id;
});

describe("seedDemo", () => {
  it("is idempotent: two demo users and two demo projects", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const demoUsers = await db().select().from(s.users).where(eq(s.users.isDemo, true));
    expect(demoUsers.map((u) => u.githubId).sort()).toEqual(["demo:client", "demo:freelancer"]);
    expect((await demoProjects()).map((p) => p.title)).toEqual(["Bakery website", "TaskBoard"]);
  });

  it("seeds TaskBoard as an unapproved version 1 from the cache, and Bakery as a brief only", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const [bakery, taskboard] = await demoProjects();
    const client = await demoUserId(db(), "client");
    const freelancer = await demoUserId(db(), "freelancer");
    const v = await getCurrentVersion(db(), { userId: freelancer!, projectId: taskboard!.id });
    expect(v.ok && v.value).toMatchObject({ version: 1, clientApprovedAt: null, freelancerApprovedAt: null, locked: false });
    expect(await getCurrentVersion(db(), { userId: client!, projectId: bakery!.id })).toEqual({ ok: true, value: null });
    const cached = await db().select().from(s.aiCache);
    expect(cached).toHaveLength(1);
    for (const p of [bakery!, taskboard!]) expect(await verifyChain(db(), p.id)).toMatchObject({ ok: true });
  });

  it("leaves TaskBoard uncompiled when the cache has no entry for it", async () => {
    await seedDemo(db(), { model: MODEL, cache: {} });
    const [, taskboard] = await demoProjects();
    const client = await demoUserId(db(), "client");
    expect(await getCurrentVersion(db(), { userId: client!, projectId: taskboard!.id })).toEqual({ ok: true, value: null });
  });
});

describe("resetDemo", () => {
  it("restores the seed and removes demo projects created afterwards, leaving real data alone", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const client = (await demoUserId(db(), "client"))!;
    const extra = await createProject(db(), { userId: client, title: "Judge's own project", brief: "A judge typed this brief to try the compiler out.", budgetCents: 5000 });
    const real = await createProject(db(), { userId: realUser, title: "Real work", brief: "A real client project that must survive a demo reset.", budgetCents: 5000 });
    if (!extra.ok || !real.ok) throw new Error("setup");

    expect(await resetDemo(db(), { userId: client, model: MODEL, cache: fixture() })).toEqual({ ok: true, value: undefined });
    const titles = (await demoProjects()).map((p) => p.title);
    expect(titles).toEqual(["Bakery website", "TaskBoard"]);
    const [stillReal] = await db().select().from(s.projects).where(eq(s.projects.id, real.value.projectId));
    expect(stillReal!.title).toBe("Real work");
    expect(await verifyChain(db(), real.value.projectId)).toEqual({ ok: true, count: 1 });
    const [, taskboard] = await demoProjects();
    const actions = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, taskboard!.id))).map((e) => e.action);
    expect(actions).toContain("demo_reset");
  });

  it("removes every child row of the old demo projects", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const oldIds = (await demoProjects()).map((p) => p.id);
    const client = (await demoUserId(db(), "client"))!;
    expect((await resetDemo(db(), { userId: client, model: MODEL, cache: fixture() })).ok).toBe(true);
    for (const table of [s.auditEvents, s.projectMembers, s.agreements, s.compileJobs, s.invitations] as const) {
      expect(await db().select().from(table).where(inArray(table.projectId, oldIds))).toEqual([]);
    }
  });

  it("is for demo users only", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    expect(await resetDemo(db(), { userId: realUser, model: MODEL, cache: fixture() })).toEqual({ ok: false, error: "not_demo" });
    expect(await resetDemo(db(), { userId: "not-a-uuid", model: MODEL, cache: fixture() })).toEqual({ ok: false, error: "not_demo" });
  });

  it("refuses a second reset within 30 seconds", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const client = (await demoUserId(db(), "client"))!;
    expect((await resetDemo(db(), { userId: client, model: MODEL, cache: fixture() })).ok).toBe(true);
    expect(await resetDemo(db(), { userId: client, model: MODEL, cache: fixture() })).toEqual({ ok: false, error: "too_soon" });
  });

  it("keeps demo users out of real projects", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    await createProject(db(), { userId: realUser, title: "Real work", brief: "A real client project that demo users must never see.", budgetCents: 5000 });
    const client = (await demoUserId(db(), "client"))!;
    expect((await listProjectsForUser(db(), client)).map((p) => p.title).sort()).toEqual(["Bakery website", "TaskBoard"]);
    expect(await listProjectsForUser(db(), realUser)).toHaveLength(1);
  });
});
