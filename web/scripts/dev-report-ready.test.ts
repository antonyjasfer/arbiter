import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../src/server/db/test-db";
import * as s from "../src/server/db/schema";
import { createFakePaypal } from "../src/server/payments/fake-paypal";
import { latestRunVerdicts } from "../src/server/payments/verdicts";
import { auditActions, fundMilestone, lockedProject, milestoneRow, type Fixture } from "../src/server/payments/test-fixtures";
import { devReportReady } from "./dev-report-ready";

const db = setupTestDb();
let f: Fixture;
let m1: string;
const SANDBOX = { PAYPAL_ENVIRONMENT: "SANDBOX" };

beforeEach(async () => {
  f = await lockedProject(db());
  m1 = f.milestoneIds[0]!;
});

describe("dev-report-ready (test-only CLI)", () => {
  it("refuses unless PAYPAL_ENVIRONMENT is SANDBOX, and changes nothing", async () => {
    await fundMilestone(db(), createFakePaypal(), f, m1);
    expect(await devReportReady(db(), { milestoneId: m1, env: {} })).toEqual({ ok: false, error: "not_sandbox" });
    expect(await devReportReady(db(), { milestoneId: m1, env: { PAYPAL_ENVIRONMENT: "LIVE" } })).toEqual({ ok: false, error: "not_sandbox" });
    expect((await milestoneRow(db(), m1)).state).toBe("FUNDED");
  });

  it("refuses a malformed id and a milestone that is not FUNDED", async () => {
    expect(await devReportReady(db(), { milestoneId: "nope", env: SANDBOX })).toEqual({ ok: false, error: "not_found" });
    expect(await devReportReady(db(), { milestoneId: m1, env: SANDBOX })).toEqual({ ok: false, error: "not_funded" });
    expect((await milestoneRow(db(), m1)).state).toBe("AGREED");
  });

  it("moves FUNDED -> REPORT_READY with a fixture submission and needs_review verdicts, audited as test-only", async () => {
    await fundMilestone(db(), createFakePaypal(), f, m1);
    expect(await devReportReady(db(), { milestoneId: m1, env: SANDBOX })).toEqual({ ok: true, value: { state: "REPORT_READY" } });
    expect((await milestoneRow(db(), m1)).state).toBe("REPORT_READY");
    // Never a PASS: nothing was verified, so every criterion is needs_review and says why.
    expect(await latestRunVerdicts(db())(m1)).toEqual(["needs_review"]);
    const [cr] = await db().select().from(s.checkResults);
    expect(cr!.summary).toMatch(/test-only/i);
    const [sub] = await db().select().from(s.submissions).where(eq(s.submissions.milestoneId, m1));
    expect(sub!.submittedBy).toBe(f.freelancer);
    expect(await auditActions(db(), f.projectId)).toEqual(expect.arrayContaining(["submission_created", "verification_started", "verification_finished"]));
    const events = await db().select().from(s.auditEvents).where(eq(s.auditEvents.action, "verification_finished"));
    expect(events[0]!.data).toMatchObject({ testOnly: true, script: "scripts/dev-report-ready.ts" });
  });

  it("a second run does nothing (the milestone is no longer FUNDED)", async () => {
    await fundMilestone(db(), createFakePaypal(), f, m1);
    await devReportReady(db(), { milestoneId: m1, env: SANDBOX });
    expect(await devReportReady(db(), { milestoneId: m1, env: SANDBOX })).toEqual({ ok: false, error: "not_funded" });
    expect(await db().select().from(s.submissions)).toHaveLength(1);
  });
});
