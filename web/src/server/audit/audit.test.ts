import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { appendAudit, verifyChain } from "./audit";

const db = setupTestDb();
let projectId: string;
let userId: string;

beforeEach(async () => {
  const [u] = await db().insert(s.users).values({ githubId: "1", login: "alice" }).returning();
  const [p] = await db().insert(s.projects).values({ title: "P", createdBy: u!.id, brief: "b", budget: "100.00" }).returning();
  userId = u!.id;
  projectId = p!.id;
});

async function appendThree() {
  for (const action of ["project_created", "invite_created", "invite_accepted"] as const) {
    await db().transaction((tx) => appendAudit(tx, { projectId, actorId: userId, action, data: { n: action.length } }));
  }
}

describe("audit chain", () => {
  it("verifies an untouched chain and links each event to the previous one", async () => {
    await appendThree();
    expect(await verifyChain(db(), projectId)).toEqual({ ok: true, count: 3 });
    const rows = await db().select().from(s.auditEvents).orderBy(s.auditEvents.seq);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    const [p] = await db().select().from(s.projects).where(eq(s.projects.id, projectId));
    expect(p!.auditSeq).toBe(3);
    expect(p!.auditHeadHash).toBe(rows[2]!.hash);
  });

  it("verifies an empty chain", async () => {
    expect(await verifyChain(db(), projectId)).toEqual({ ok: true, count: 0 });
  });

  it("detects an edited event", async () => {
    await appendThree();
    await db().update(s.auditEvents).set({ data: { n: 999 } }).where(and(eq(s.auditEvents.projectId, projectId), eq(s.auditEvents.seq, 2)));
    expect(await verifyChain(db(), projectId)).toEqual({ ok: false, seq: 2, problem: "hash_mismatch" });
  });

  it("detects a deleted event in the middle", async () => {
    await appendThree();
    await db().delete(s.auditEvents).where(and(eq(s.auditEvents.projectId, projectId), eq(s.auditEvents.seq, 2)));
    expect(await verifyChain(db(), projectId)).toEqual({ ok: false, seq: 2, problem: "gap" });
  });

  it("detects the last event being deleted", async () => {
    await appendThree();
    await db().delete(s.auditEvents).where(and(eq(s.auditEvents.projectId, projectId), eq(s.auditEvents.seq, 3)));
    expect(await verifyChain(db(), projectId)).toEqual({ ok: false, seq: 3, problem: "head_mismatch" });
  });

  it("detects a rewired prev_hash", async () => {
    await appendThree();
    await db().update(s.auditEvents).set({ prevHash: "f".repeat(64) }).where(and(eq(s.auditEvents.projectId, projectId), eq(s.auditEvents.seq, 3)));
    expect(await verifyChain(db(), projectId)).toEqual({ ok: false, seq: 3, problem: "prev_mismatch" });
  });

  it("detects an edited timestamp", async () => {
    await appendThree();
    await db().execute(sql`update audit_events set created_at = created_at + interval '1 second' where project_id = ${projectId} and seq = 1`);
    expect(await verifyChain(db(), projectId)).toEqual({ ok: false, seq: 1, problem: "hash_mismatch" });
  });

  it("never forks when two events are appended at the same time", async () => {
    await Promise.all(
      (["approved", "approved"] as const).map((action) =>
        db().transaction((tx) => appendAudit(tx, { projectId, actorId: userId, action, data: {} })),
      ),
    );
    expect(await verifyChain(db(), projectId)).toEqual({ ok: true, count: 2 });
  });
});
