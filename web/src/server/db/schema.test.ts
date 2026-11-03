import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./test-db";
import * as s from "./schema";

let t: { db: TestDb; close: () => Promise<void> };
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

async function seedProject() {
  const [user] = await t.db.insert(s.users).values({ githubId: "1", login: "alice" }).returning();
  const [project] = await t.db.insert(s.projects).values({ title: "Bakery site", createdBy: user!.id }).returning();
  return { user: user!, project: project! };
}

describe("schema", () => {
  it("creates all 16 tables", async () => {
    const r = await t.db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    expect((r.rows[0] as { n: number }).n).toBe(16);
  });

  it("rejects a second membership for the same project and user", async () => {
    const { user, project } = await seedProject();
    await t.db.insert(s.projectMembers).values({ projectId: project.id, userId: user.id, role: "client" });
    await expect(t.db.insert(s.projectMembers).values({ projectId: project.id, userId: user.id, role: "freelancer" })).rejects.toThrow();
  });

  it("rejects a duplicate PayPal event id", async () => {
    const e = { paypalEventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED", resourceType: "capture", resourceId: "C1", verified: true, payloadSha256: "a".repeat(64) };
    await t.db.insert(s.webhookEvents).values(e);
    await expect(t.db.insert(s.webhookEvents).values(e)).rejects.toThrow();
  });

  it("stores money as an exact string", async () => {
    const { project } = await seedProject();
    const [agreement] = await t.db.insert(s.agreements).values({ projectId: project.id }).returning();
    const [version] = await t.db.insert(s.agreementVersions).values({ agreementId: agreement!.id, version: 1, bodyJson: {}, hash: "h1" }).returning();
    const [m] = await t.db.insert(s.milestones).values({ agreementVersionId: version!.id, position: 1, title: "Home page", amount: "50.00" }).returning();
    const [read] = await t.db.select().from(s.milestones).where(eq(s.milestones.id, m!.id));
    expect(read!.amount).toBe("50.00");
    expect(read!.currency).toBe("USD");
    expect(read!.state).toBe("DRAFT");
    expect(read!.stateVersion).toBe(0);
  });
});
