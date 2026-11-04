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
  it("creates all 19 tables, including compile_jobs, ai_cache and ai_usage", async () => {
    const r = await db().execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = r.rows.map((x) => (x as { table_name: string }).table_name);
    expect(names).toHaveLength(19);
    expect(names).toEqual(expect.arrayContaining(["compile_jobs", "ai_cache", "ai_usage"]));
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
