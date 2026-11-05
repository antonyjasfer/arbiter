import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb } from "./test-db";
import * as s from "./schema";

const db = setupTestDb();

async function seedProject() {
  const [user] = await db().insert(s.users).values({ githubId: "1", login: "alice" }).returning();
  const [project] = await db()
    .insert(s.projects)
    .values({ title: "Bakery site", createdBy: user!.id, brief: "A bakery website with a menu.", budget: "400.00" })
    .returning();
  return { user: user!, project: project! };
}

describe("schema", () => {
  it("creates all 20 tables, including the Phase 3 tables and check_plans", async () => {
    const r = await db().execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = r.rows.map((x) => (x as { table_name: string }).table_name);
    expect(names).toHaveLength(20);
    expect(names).toEqual(expect.arrayContaining(["compile_jobs", "ai_cache", "ai_usage", "check_plans"]));
  });

  // Phase 4/5 shared migration (0003): the guarantees both branches rely on.
  async function lockedMilestone() {
    const { user, project } = await seedProject();
    const [agreement] = await db().insert(s.agreements).values({ projectId: project.id }).returning();
    const [version] = await db().insert(s.agreementVersions).values({ agreementId: agreement!.id, version: 1, bodyJson: {}, hash: "h", source: "manual" }).returning();
    const [m] = await db().insert(s.milestones).values({ agreementVersionId: version!.id, position: 1, title: "M", amount: "150.00" }).returning();
    return { user, milestone: m! };
  }

  it("allows one live payment per milestone, and any number of superseded ones", async () => {
    const { milestone } = await lockedMilestone();
    await db().insert(s.payments).values({ milestoneId: milestone.id, status: "voided", amount: "150.00", supersededAt: new Date() });
    await db().insert(s.payments).values({ milestoneId: milestone.id, status: "authorized", amount: "150.00", paypalOrderId: "ORDER-1" });
    await expect(db().insert(s.payments).values({ milestoneId: milestone.id, status: "created", amount: "150.00" })).rejects.toThrow();
    await expect(db().insert(s.payments).values({ milestoneId: milestone.id, status: "x", amount: "1.00", paypalOrderId: "ORDER-1", supersededAt: new Date() })).rejects.toThrow();
  });

  it("allows one live submission per milestone and stores evidence bytes with their size", async () => {
    const { user, milestone } = await lockedMilestone();
    const sub = { milestoneId: milestone.id, repoUrl: "https://github.com/a/b", commitSha: "a".repeat(40), deployUrl: "https://x.onrender.com", submittedBy: user.id };
    const [first] = await db().insert(s.submissions).values(sub).returning();
    await expect(db().insert(s.submissions).values(sub)).rejects.toThrow();
    await db().update(s.submissions).set({ supersededAt: new Date() }).where(eq(s.submissions.id, first!.id));
    await db().insert(s.submissions).values(sub);
    const [run] = await db().insert(s.verificationRuns).values({ submissionId: first!.id }).returning();
    expect(run!.dispatchKey).toMatch(/^[0-9a-f-]{36}$/);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const [ev] = await db().insert(s.evidence).values({ runId: run!.id, type: "screenshot", uri: "/api/evidence/x", sha256: "b".repeat(64), content: png, contentType: "image/png", byteSize: 4 }).returning();
    const [read] = await db().select().from(s.evidence).where(eq(s.evidence.id, ev!.id));
    expect(Buffer.from(read!.content!)).toEqual(png);
    expect(read!.checkResultId).toBeNull();
  });

  it("allows only one freelancer per project", async () => {
    const { project } = await seedProject();
    const [f1] = await db().insert(s.users).values({ githubId: "2", login: "bob" }).returning();
    const [f2] = await db().insert(s.users).values({ githubId: "3", login: "carol" }).returning();
    await db().insert(s.projectMembers).values({ projectId: project.id, userId: f1!.id, role: "freelancer" });
    await expect(db().insert(s.projectMembers).values({ projectId: project.id, userId: f2!.id, role: "freelancer" })).rejects.toThrow();
  });

  it("defaults users and projects to non-demo", async () => {
    const { user, project } = await seedProject();
    expect(user.isDemo).toBe(false);
    expect(project.isDemo).toBe(false);
    expect(project.auditSeq).toBe(0);
  });

  it("rejects a second membership for the same project and user", async () => {
    const { user, project } = await seedProject();
    await db().insert(s.projectMembers).values({ projectId: project.id, userId: user.id, role: "client" });
    await expect(db().insert(s.projectMembers).values({ projectId: project.id, userId: user.id, role: "freelancer" })).rejects.toThrow();
  });

  it("rejects a duplicate PayPal event id", async () => {
    const e = { paypalEventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED", resourceType: "capture", resourceId: "C1", verified: true, payloadSha256: "a".repeat(64) };
    await db().insert(s.webhookEvents).values(e);
    await expect(db().insert(s.webhookEvents).values(e)).rejects.toThrow();
  });

  it("stores money as an exact string", async () => {
    const { project } = await seedProject();
    const [agreement] = await db().insert(s.agreements).values({ projectId: project.id }).returning();
    const [version] = await db().insert(s.agreementVersions).values({ agreementId: agreement!.id, version: 1, bodyJson: {}, hash: "h1", source: "manual" }).returning();
    const [m] = await db().insert(s.milestones).values({ agreementVersionId: version!.id, position: 1, title: "Home page", amount: "50.00" }).returning();
    const [read] = await db().select().from(s.milestones).where(eq(s.milestones.id, m!.id));
    expect(read!.amount).toBe("50.00");
    expect(read!.currency).toBe("USD");
    expect(read!.state).toBe("DRAFT");
    expect(read!.stateVersion).toBe(0);
  });
});
