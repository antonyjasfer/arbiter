import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { verifyChain } from "../audit/audit";
import { createProject } from "./projects";
import { acceptInvite, createInvite } from "./invitations";

const db = setupTestDb();
const brief = "A small task-list web app with add, complete and filter, and a health check.";
let client: string, freelancer: string, other: string, demoClient: string, demoFreelancer: string;
let projectId: string, demoProjectId: string;

beforeEach(async () => {
  const users = await db()
    .insert(s.users)
    .values([
      { githubId: "1", login: "client" },
      { githubId: "2", login: "freelancer" },
      { githubId: "3", login: "other" },
      { githubId: "demo:client", login: "dc", isDemo: true },
      { githubId: "demo:freelancer", login: "df", isDemo: true },
    ])
    .returning();
  [client, freelancer, other, demoClient, demoFreelancer] = users.map((u) => u.id) as [string, string, string, string, string];
  const p = await createProject(db(), { userId: client, title: "Real", brief, budgetCents: 30000 });
  const d = await createProject(db(), { userId: demoClient, title: "Demo", brief, budgetCents: 30000 });
  if (!p.ok || !d.ok) throw new Error("setup");
  projectId = p.value.projectId;
  demoProjectId = d.value.projectId;
});

async function invite(pid = projectId, uid = client) {
  const r = await createInvite(db(), { userId: uid, projectId: pid });
  if (!r.ok) throw new Error(r.error);
  return r.value.token;
}

describe("createInvite", () => {
  it("stores only a hash of the token, expiring in 7 days", async () => {
    const now = new Date("2026-11-04T00:00:00Z");
    const r = await createInvite(db(), { userId: client, projectId, now });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.value.expiresAt.toISOString()).toBe("2026-11-11T00:00:00.000Z");
    const rows = await db().select().from(s.invitations);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(r.value.token);
  });

  it("is client-only", async () => {
    const token = await invite();
    await acceptInvite(db(), { userId: freelancer, token });
    expect(await createInvite(db(), { userId: freelancer, projectId })).toEqual({ ok: false, error: "forbidden" });
    expect(await createInvite(db(), { userId: other, projectId })).toEqual({ ok: false, error: "not_member" });
  });

  it("refuses once a freelancer has joined, and replaces older unused invites", async () => {
    const first = await invite();
    const second = await invite();
    expect(await acceptInvite(db(), { userId: freelancer, token: first })).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvite(db(), { userId: freelancer, token: second })).toEqual({ ok: true, value: { projectId } });
    expect(await createInvite(db(), { userId: client, projectId })).toEqual({ ok: false, error: "has_freelancer" });
  });
});

describe("acceptInvite", () => {
  it("adds the freelancer once and audits it", async () => {
    const token = await invite();
    expect(await acceptInvite(db(), { userId: freelancer, token })).toEqual({ ok: true, value: { projectId } });
    expect(await acceptInvite(db(), { userId: other, token })).toEqual({ ok: false, error: "invalid" });
    const members = await db().select().from(s.projectMembers).where(eq(s.projectMembers.projectId, projectId));
    expect(members.map((m) => m.role).sort()).toEqual(["client", "freelancer"]);
    const actions = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId)).orderBy(s.auditEvents.seq)).map((e) => e.action);
    expect(actions).toEqual(["project_created", "invite_created", "invite_accepted"]);
    expect(await verifyChain(db(), projectId)).toEqual({ ok: true, count: 3 });
  });

  it("refuses an expired token", async () => {
    const r = await createInvite(db(), { userId: client, projectId, now: new Date("2026-01-01T00:00:00Z") });
    if (!r.ok) throw new Error(r.error);
    expect(await acceptInvite(db(), { userId: freelancer, token: r.value.token, now: new Date("2026-01-08T00:00:01Z") })).toEqual({ ok: false, error: "invalid" });
  });

  it("refuses the client's own invite and leaves it usable", async () => {
    const token = await invite();
    expect(await acceptInvite(db(), { userId: client, token })).toEqual({ ok: false, error: "own_project" });
    expect(await acceptInvite(db(), { userId: freelancer, token })).toEqual({ ok: true, value: { projectId } });
  });

  it("refuses unknown and malformed tokens", async () => {
    expect(await acceptInvite(db(), { userId: freelancer, token: "A".repeat(43) })).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvite(db(), { userId: freelancer, token: "'; drop table users; --" })).toEqual({ ok: false, error: "invalid" });
  });

  it("keeps demo and real users apart in both directions", async () => {
    const realToken = await invite();
    expect(await acceptInvite(db(), { userId: demoFreelancer, token: realToken })).toEqual({ ok: false, error: "invalid" });
    const demoToken = await invite(demoProjectId, demoClient);
    expect(await acceptInvite(db(), { userId: freelancer, token: demoToken })).toEqual({ ok: false, error: "invalid" });
    // Both tokens still work for the right kind of user.
    expect(await acceptInvite(db(), { userId: freelancer, token: realToken })).toEqual({ ok: true, value: { projectId } });
    expect(await acceptInvite(db(), { userId: demoFreelancer, token: demoToken })).toEqual({ ok: true, value: { projectId: demoProjectId } });
  });
});
