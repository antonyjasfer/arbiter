import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../db/test-db";
import * as s from "../db/schema";
import { transitionMilestone } from "./transition";

let t: { db: TestDb; close: () => Promise<void> };
let milestoneId: string;

beforeEach(async () => {
  t = await createTestDb();
  const [u] = await t.db.insert(s.users).values({ githubId: "1", login: "alice" }).returning();
  const [p] = await t.db.insert(s.projects).values({ title: "P", createdBy: u!.id }).returning();
  const [a] = await t.db.insert(s.agreements).values({ projectId: p!.id }).returning();
  const [v] = await t.db.insert(s.agreementVersions).values({ agreementId: a!.id, version: 1, bodyJson: {}, hash: "h" }).returning();
  const [m] = await t.db.insert(s.milestones).values({ agreementVersionId: v!.id, position: 1, title: "M", amount: "50.00" }).returning();
  milestoneId = m!.id;
});
afterEach(async () => {
  await t.close();
});

const read = async () => (await t.db.select().from(s.milestones).where(eq(s.milestones.id, milestoneId)))[0]!;

describe("transitionMilestone", () => {
  it("moves a legal transition and increments state_version", async () => {
    const r = await transitionMilestone(t.db, { milestoneId, expectedState: "DRAFT", expectedVersion: 0, event: "both_approved" });
    expect(r).toEqual({ ok: true, value: { state: "AGREED", stateVersion: 1 } });
    expect((await read()).state).toBe("AGREED");
  });

  it("returns conflict when the expected state is stale", async () => {
    const r = await transitionMilestone(t.db, { milestoneId, expectedState: "AGREED", expectedVersion: 0, event: "authorized" });
    expect(r).toEqual({ ok: false, error: "conflict" });
    expect(await read()).toMatchObject({ state: "DRAFT", stateVersion: 0 });
  });

  it("lets exactly one of two racing transitions win", async () => {
    const args = { milestoneId, expectedState: "DRAFT", expectedVersion: 0, event: "both_approved" } as const;
    const results = await Promise.all([transitionMilestone(t.db, args), transitionMilestone(t.db, args)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "conflict")).toHaveLength(1);
    expect(await read()).toMatchObject({ state: "AGREED", stateVersion: 1 });
  });

  it("rejects an illegal event without touching the row", async () => {
    const r = await transitionMilestone(t.db, { milestoneId, expectedState: "DRAFT", expectedVersion: 0, event: "payout_succeeded" });
    expect(r).toEqual({ ok: false, error: "illegal_transition" });
    expect(await read()).toMatchObject({ state: "DRAFT", stateVersion: 0 });
  });
});
