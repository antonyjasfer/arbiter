import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { latestRunVerdicts } from "./verdicts";
import { lockedProject, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
const SHA = "a".repeat(40);

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
});

async function submission(supersededAt: Date | null = null): Promise<string> {
  const [row] = await db()
    .insert(s.submissions)
    .values({ milestoneId: m1, repoUrl: "https://github.com/x/y", commitSha: SHA, deployUrl: "https://x.example", submittedBy: f.freelancer, supersededAt })
    .returning({ id: s.submissions.id });
  return row!.id;
}

async function run(submissionId: string, status: "queued" | "running" | "completed" | "errored", verdicts: ("pass" | "fail" | "needs_review")[], createdAt = new Date()) {
  const [r] = await db().insert(s.verificationRuns).values({ submissionId, status, createdAt }).returning({ id: s.verificationRuns.id });
  const criteria = await db().select({ id: s.acceptanceCriteria.id }).from(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.milestoneId, m1));
  while (criteria.length < verdicts.length) {
    const [c] = await db().insert(s.acceptanceCriteria).values({ milestoneId: m1, kind: "test", text: "extra" }).returning({ id: s.acceptanceCriteria.id });
    criteria.push(c!);
  }
  for (const [i, v] of verdicts.entries()) {
    await db().insert(s.checkResults).values({ runId: r!.id, criterionId: criteria[i]!.id, verdict: v, source: "deterministic" });
  }
}

describe("latestRunVerdicts", () => {
  it("is null with no submission, or when the latest run has not completed", async () => {
    expect(await latestRunVerdicts(db())(m1)).toBeNull();
    const sub = await submission();
    await run(sub, "running", []);
    expect(await latestRunVerdicts(db())(m1)).toBeNull();
  });

  it("returns the verdicts of the latest completed run of the live submission", async () => {
    const sub = await submission();
    await run(sub, "completed", ["pass", "fail"]);
    expect((await latestRunVerdicts(db())(m1))?.sort()).toEqual(["fail", "pass"]);
  });

  it("uses only the newest run: a later run that is still running hides an older report", async () => {
    const sub = await submission();
    await run(sub, "completed", ["pass"], new Date(Date.now() - 60_000));
    await run(sub, "running", []);
    expect(await latestRunVerdicts(db())(m1)).toBeNull();
  });

  it("ignores runs of a superseded submission", async () => {
    const old = await submission(new Date());
    await run(old, "completed", ["pass"]);
    expect(await latestRunVerdicts(db())(m1)).toBeNull();
  });

  it("treats a completed run with no check results as no report", async () => {
    const sub = await submission();
    await run(sub, "completed", []);
    expect(await latestRunVerdicts(db())(m1)).toBeNull();
  });
});
