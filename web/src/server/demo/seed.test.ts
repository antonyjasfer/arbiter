import { beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { cacheKeyFor } from "../ai/structured-ai";
import { verifyChain } from "../audit/audit";
import { buildCompileRequest, type CompilerOutput } from "../agreements/compiler";
import { getCurrentVersion } from "../agreements/versions";
import { startCompile } from "../agreements/compile-jobs";
import { createProject, listProjectsForUser } from "../projects/projects";
import { DEMO_BRIEFS } from "./briefs";
import { approve } from "../agreements/versions";
import { demoUserId, isKeptPayment, keptDemoProjectIds, resetDemo, seedDemo, type DemoCache } from "./seed";

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
  it("gives the demo freelancer the sandbox PayPal email when one is configured", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture(), freelancerPaypalEmail: "freelancer@example.test" });
    const [f] = await db().select().from(s.users).where(eq(s.users.githubId, "demo:freelancer"));
    expect(f!.paypalEmail).toBe("freelancer@example.test");
    await seedDemo(db(), { model: MODEL, cache: fixture() }); // a later seed without one keeps it
    const [again] = await db().select().from(s.users).where(eq(s.users.githubId, "demo:freelancer"));
    expect(again!.paypalEmail).toBe("freelancer@example.test");
  });

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

  it("does not reset the shared demo AI cap", async () => {
    await seedDemo(db(), { model: MODEL, cache: fixture() });
    const client = (await demoUserId(db(), "client"))!;
    const day = new Date().toISOString().slice(0, 10);
    await db().insert(s.aiUsage).values({ day, scope: "demo", n: 20 });
    expect((await resetDemo(db(), { userId: client, model: MODEL, cache: fixture() })).ok).toBe(true);
    const bakery = (await db().select().from(s.projects).where(eq(s.projects.isDemo, true))).find((p) => p.title === "Bakery website")!;
    expect(await startCompile(db(), { userId: client, projectId: bakery.id, model: "uncached-model" })).toEqual({ ok: false, error: "demo_cap" });
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

// Task 6: Reset demo keeps every project with a live PayPal payment (real sandbox money), and rebuilds the rest.
async function lockProject(projectId: string, client: string, freelancer: string): Promise<string[]> {
  for (const userId of [client, freelancer]) {
    const v = await getCurrentVersion(db(), { userId, projectId });
    if (!v.ok || !v.value) throw new Error("setup: no version");
    const r = await approve(db(), { userId, projectId, expectedHash: v.value.hash });
    if (!r.ok) throw new Error("setup: approve");
  }
  const ms = await db()
    .select({ id: s.milestones.id })
    .from(s.milestones)
    .innerJoin(s.agreementVersions, eq(s.agreementVersions.id, s.milestones.agreementVersionId))
    .innerJoin(s.agreements, eq(s.agreements.id, s.agreementVersions.agreementId))
    .where(eq(s.agreements.projectId, projectId));
  return ms.map((m) => m.id);
}
async function lockedTaskboard() {
  await seedDemo(db(), { model: MODEL, cache: fixture() });
  const taskboard = (await demoProjects()).find((p) => p.title === "TaskBoard")!;
  const client = (await demoUserId(db(), "client"))!;
  const freelancer = (await demoUserId(db(), "freelancer"))!;
  return { projectId: taskboard.id, client, freelancer, milestoneIds: await lockProject(taskboard.id, client, freelancer) };
}
async function payment(milestoneId: string, status: string, createdAt = new Date(), extra: Partial<typeof s.payments.$inferInsert> = {}) {
  await db().insert(s.payments).values({ milestoneId, status, amount: "150.00", createdAt, ...extra });
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const reset = async (client: string) => resetDemo(db(), { userId: client, model: MODEL, cache: fixture() });
const projectExists = async (id: string) => (await db().select().from(s.projects).where(eq(s.projects.id, id))).length === 1;
const KEPT = ["authorized", "approved", "capture_pending", "captured", "capture_denied", "payout_pending", "payout_failed", "payout_unknown", "paid"];

describe("isKeptPayment", () => {
  const now = new Date();
  it.each(KEPT)("keeps %s", (status) => {
    expect(isKeptPayment({ status, createdAt: hoursAgo(1000) }, now)).toBe(true);
  });
  it("drops voided and authorization_lost, and an order_pending older than 24 hours", () => {
    expect(isKeptPayment({ status: "voided", createdAt: now }, now)).toBe(false);
    expect(isKeptPayment({ status: "authorization_lost", createdAt: now }, now)).toBe(false);
    expect(isKeptPayment({ status: "order_pending", createdAt: hoursAgo(23) }, now)).toBe(true);
    expect(isKeptPayment({ status: "order_pending", createdAt: hoursAgo(25) }, now)).toBe(false);
  });
});

describe("resetDemo keeps projects with a live PayPal payment", () => {
  it("a TaskBoard with a pending capture survives with every row and an intact audit chain, next to fresh seed projects", async () => {
    const tb = await lockedTaskboard();
    const m1 = tb.milestoneIds[0]!;
    await db().update(s.milestones).set({ state: "CAPTURE_PENDING" }).where(eq(s.milestones.id, m1));
    await payment(m1, "capture_pending", hoursAgo(72), { captureId: "24140907B72033302", captureStatus: "PENDING" });
    const msBefore = await db().select().from(s.milestones).where(inArray(s.milestones.id, tb.milestoneIds));
    const auditBefore = await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, tb.projectId));

    expect(await reset(tb.client)).toEqual({ ok: true, value: undefined });

    expect(await projectExists(tb.projectId)).toBe(true);
    expect(await db().select().from(s.milestones).where(inArray(s.milestones.id, tb.milestoneIds))).toEqual(msBefore);
    expect(await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, tb.projectId))).toEqual(auditBefore);
    const [p] = await db().select().from(s.payments).where(eq(s.payments.milestoneId, m1));
    expect(p!.captureId).toBe("24140907B72033302");
    expect(await verifyChain(db(), tb.projectId)).toMatchObject({ ok: true });
    expect((await demoProjects()).map((x) => x.title)).toEqual(["Bakery website", "TaskBoard", "TaskBoard"]);
    expect(await keptDemoProjectIds(db())).toEqual(new Set([tb.projectId]));
  });

  it.each(KEPT)("keeps a project whose payment is %s", async (status) => {
    const tb = await lockedTaskboard();
    await payment(tb.milestoneIds[0]!, status, hoursAgo(1000));
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(true);
  });

  it("keeps a 23-hour-old order_pending (the buyer may be approving)", async () => {
    const tb = await lockedTaskboard();
    await payment(tb.milestoneIds[0]!, "order_pending", hoursAgo(23));
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(true);
  });

  it("drops a project whose only payment is a 25-hour-old order_pending", async () => {
    const tb = await lockedTaskboard();
    await payment(tb.milestoneIds[0]!, "order_pending", hoursAgo(25));
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(false);
  });

  it("deletes a project whose only payment was voided", async () => {
    const tb = await lockedTaskboard();
    await payment(tb.milestoneIds[0]!, "voided");
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(false);
    expect((await demoProjects()).map((x) => x.title)).toEqual(["Bakery website", "TaskBoard"]);
    expect(await keptDemoProjectIds(db())).toEqual(new Set());
  });

  it("deletes a dropped project whose milestone has a check plan (review I1: check_plans FK)", async () => {
    // Like the Phase 4 demo projects on live: FUNDED by the old test-only script (no payment row), then verified.
    const tb = await lockedTaskboard();
    await db().insert(s.checkPlans).values({ milestoneId: tb.milestoneIds[0]!, criteriaHash: "d".repeat(64), plan: {}, model: "gemini-test" });
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(false);
    expect(await db().select().from(s.checkPlans)).toEqual([]);
  });

  it("deletes a project with a verification run and run-level evidence (null check_result_id) cleanly", async () => {
    const tb = await lockedTaskboard();
    const m1 = tb.milestoneIds[0]!;
    const [sub] = await db()
      .insert(s.submissions)
      .values({ milestoneId: m1, repoUrl: "https://github.com/x/y", commitSha: "c".repeat(40), deployUrl: "https://x.example", submittedBy: tb.freelancer })
      .returning({ id: s.submissions.id });
    const [run] = await db().insert(s.verificationRuns).values({ submissionId: sub!.id, status: "completed" }).returning({ id: s.verificationRuns.id });
    await db().insert(s.evidence).values({ runId: run!.id, checkResultId: null, type: "run_link", uri: "https://github.com/x/actions/runs/1", sha256: "0".repeat(64) });
    expect((await reset(tb.client)).ok).toBe(true);
    expect(await projectExists(tb.projectId)).toBe(false);
    expect(await db().select().from(s.evidence)).toEqual([]);
  });
});
