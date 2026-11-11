import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import { getReport } from "../verification/report";
import { createFakePaypal } from "./fake-paypal";
import { checkRelease, type LatestVerdicts } from "./guard";
import { guardVerdicts, toGuardVerdicts } from "./verdicts";
import { fundMilestone, lockedProject, milestoneRow, toReportReady, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;
let m1: string;
const SHA = "a".repeat(40);
const REASON = "The failing check was a flaky network test; I reviewed the demo myself.";

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
  await fundMilestone(db(), createFakePaypal(), f, m1);
  await toReportReady(db(), m1);
});

async function submission(supersededAt: Date | null = null, fields: Partial<typeof s.submissions.$inferInsert> = {}): Promise<string> {
  const [row] = await db()
    .insert(s.submissions)
    .values({ milestoneId: m1, repoUrl: "https://github.com/x/y", commitSha: SHA, deployUrl: "https://x.example", submittedBy: f.freelancer, supersededAt, ...fields })
    .returning({ id: s.submissions.id });
  return row!.id;
}

async function run(
  submissionId: string,
  status: "queued" | "running" | "completed" | "errored",
  verdicts: ("pass" | "fail" | "needs_review")[],
  extra: Partial<typeof s.verificationRuns.$inferInsert> = {},
) {
  const [r] = await db().insert(s.verificationRuns).values({ submissionId, status, ...extra }).returning({ id: s.verificationRuns.id });
  const criteria = await db().select({ id: s.acceptanceCriteria.id }).from(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.milestoneId, m1));
  while (criteria.length < verdicts.length) {
    const [c] = await db().insert(s.acceptanceCriteria).values({ milestoneId: m1, kind: "test", text: "extra" }).returning({ id: s.acceptanceCriteria.id });
    criteria.push(c!);
  }
  for (const [i, v] of verdicts.entries()) {
    await db().insert(s.checkResults).values({ runId: r!.id, criterionId: criteria[i]!.id, verdict: v, source: "deterministic" });
  }
  return r!.id;
}

const release = (over: { overrideReason?: string; latestVerdicts?: LatestVerdicts } = {}) =>
  checkRelease(db(), { userId: f.client, milestoneId: m1, latestVerdicts: guardVerdicts(db()), ...over });

describe("guardVerdicts (Phase 4 latestVerdicts → payment guard)", () => {
  it("no submission → no_report", async () => {
    expect(await guardVerdicts(db())(m1)).toBeNull();
    expect(await release()).toEqual({ ok: false, error: "no_report" });
  });

  it("a newer run in progress → milestone VERIFYING → not_releasable", async () => {
    const sub = await submission();
    await run(sub, "completed", ["pass"], { createdAt: new Date(Date.now() - 60_000) });
    await run(sub, "running", []);
    for (const event of ["resubmit", "start_verification"] as const) {
      const m = await milestoneRow(db(), m1);
      const r = await transitionMilestone(db(), { milestoneId: m1, expectedState: m.state, expectedVersion: m.stateVersion, event });
      expect(r.ok).toBe(true);
    }
    expect(await release()).toEqual({ ok: false, error: "not_releasable" });
  });

  it("a resubmission with no completed run → no_report", async () => {
    const old = await submission(new Date());
    await run(old, "completed", ["pass"]);
    const sub = await submission();
    await run(sub, "running", []);
    expect(await release()).toEqual({ ok: false, error: "no_report" });
  });

  it("a completed run with no check results → no_report", async () => {
    await run(await submission(), "completed", []);
    expect(await release()).toEqual({ ok: false, error: "no_report" });
  });

  it("a completed run with one FAIL → fail_without_override", async () => {
    await run(await submission(), "completed", ["pass", "fail"]);
    expect(await release()).toEqual({ ok: false, error: "fail_without_override" });
  });

  it("the same FAIL with an override of 20+ characters → allowed", async () => {
    await run(await submission(), "completed", ["pass", "fail"]);
    const r = await release({ overrideReason: REASON });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ hasFail: true, overrideReason: REASON });
  });

  it("an override of 25 spaces → override_too_short", async () => {
    await run(await submission(), "completed", ["fail"]);
    expect(await release({ overrideReason: " ".repeat(25) })).toEqual({ ok: false, error: "fail_without_override" });
    expect(await release({ overrideReason: `${" ".repeat(25)}too short` })).toEqual({ ok: false, error: "override_too_short" });
  });

  it("a resubmission whose new run FAILs after an older PASS → refused (the live submission wins)", async () => {
    const old = await submission(new Date());
    await run(old, "completed", ["pass"]);
    await run(await submission(), "completed", ["fail"]);
    expect(await release()).toEqual({ ok: false, error: "fail_without_override" });
  });

  it("an unexpected verdict value fails closed (throws, so nothing is released)", async () => {
    expect(() => toGuardVerdicts(["pass", "maybe"])).toThrow();
    const stub: LatestVerdicts = async (id) => toGuardVerdicts(id ? ["pass", "approved-by-ai"] : []);
    await expect(release({ latestVerdicts: stub })).rejects.toThrow();
  });

  it("the legacy Phase 5 placeholder run (test_only, null plan, all needs_review) reads as needs_review", async () => {
    // The exact shape web/scripts/dev-report-ready.ts wrote for TaskBoard milestone 1.
    const sub = await submission(null, { repoUrl: "https://github.com/arbiter-test-only/no-repo", commitSha: "0".repeat(40), deployUrl: "https://dev-report-ready.invalid/" });
    const now = new Date();
    await run(sub, "completed", ["needs_review", "needs_review"], { errorCode: "test_only", errorDetail: "test-only placeholder", plan: null, startedAt: now, finishedAt: now });
    expect(await guardVerdicts(db())(m1)).toEqual(["needs_review", "needs_review"]);
    const report = await getReport(db(), { userId: f.client, milestoneId: m1 });
    expect(report.ok).toBe(true);
    expect((await release()).ok).toBe(true);
  });
});
