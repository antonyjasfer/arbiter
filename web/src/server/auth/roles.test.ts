import { beforeEach, describe, expect, it } from "vitest";
import { parseActiveRole } from "@/lib/active-role";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { requireProjectRole } from "./roles";

const db = setupTestDb();
let client: string, freelancer: string, outsider: string, projectA: string, projectB: string;

beforeEach(async () => {
  const users = await db()
    .insert(s.users)
    .values([
      { githubId: "1", login: "client" },
      { githubId: "2", login: "freelancer" },
      { githubId: "3", login: "outsider" },
    ])
    .returning();
  [client, freelancer, outsider] = users.map((u) => u.id) as [string, string, string];
  const projects = await db()
    .insert(s.projects)
    .values([
      { title: "A", createdBy: client, brief: "brief A", budget: "100.00" },
      { title: "B", createdBy: outsider, brief: "brief B", budget: "100.00" },
    ])
    .returning();
  [projectA, projectB] = projects.map((p) => p.id) as [string, string];
  await db().insert(s.projectMembers).values([
    { projectId: projectA, userId: client, role: "client" },
    { projectId: projectA, userId: freelancer, role: "freelancer" },
  ]);
});

describe("requireProjectRole", () => {
  it("allows a member whose role is allowed", async () => {
    expect(await requireProjectRole(db(), { userId: client, projectId: projectA, allowed: ["client"] })).toEqual({ ok: true, value: { role: "client" } });
  });

  it("denies a freelancer a client action even if their view cookie says client", async () => {
    expect(parseActiveRole("client")).toBe("client"); // the switcher's view, which grants nothing
    expect(await requireProjectRole(db(), { userId: freelancer, projectId: projectA, allowed: ["client"] })).toEqual({ ok: false, error: "forbidden" });
  });

  it("denies a user who is not a member", async () => {
    expect(await requireProjectRole(db(), { userId: outsider, projectId: projectA, allowed: ["client", "freelancer"] })).toEqual({ ok: false, error: "not_member" });
  });

  it("does not carry membership across projects", async () => {
    expect(await requireProjectRole(db(), { userId: client, projectId: projectB, allowed: ["client"] })).toEqual({ ok: false, error: "not_member" });
  });
});
