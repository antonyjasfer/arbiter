import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { verifyChain } from "../audit/audit";
import { transitionMilestone } from "../milestones/transition";
import { checkDeployUrl, submitWork } from "./submissions";
import { fund, lockedProject, type Fixture } from "./test-fixtures";

const db = setupTestDb();
const SHA = "a".repeat(40);
const good = { repoUrl: "https://github.com/antonyjasfer/arbiter-demo-pass", commitSha: SHA, deployUrl: "https://arbiter-demo-pass.onrender.com" };
let f: Fixture;

const milestone = async () => (await db().select().from(s.milestones).where(eq(s.milestones.id, f.milestoneId)))[0]!;
const submit = (over: Partial<typeof good> = {}, userId = f.freelancer) => submitWork(db(), { userId, milestoneId: f.milestoneId, ...good, ...over });

beforeEach(async () => {
  f = await lockedProject(db());
});

describe("submitWork", () => {
  it("moves a FUNDED milestone to SUBMITTED, stores the submission and audits it", async () => {
    await fund(db(), f.milestoneId);
    const r = await submit();
    expect(r.ok).toBe(true);
    expect((await milestone()).state).toBe("SUBMITTED");
    const subs = await db().select().from(s.submissions);
    expect(subs.map((x) => [x.repoUrl, x.commitSha, x.deployUrl, x.submittedBy, x.supersededAt])).toEqual([[good.repoUrl, SHA, good.deployUrl, f.freelancer, null]]);
    const audit = await db().select().from(s.auditEvents).where(eq(s.auditEvents.action, "submission_created"));
    expect(audit).toHaveLength(1);
    expect(await verifyChain(db(), f.projectId)).toMatchObject({ ok: true });
  });

  it("refuses the client, an outsider and a malformed milestone id", async () => {
    await fund(db(), f.milestoneId);
    expect(await submit({}, f.client)).toEqual({ ok: false, error: "forbidden" });
    expect(await submit({}, f.outsider)).toEqual({ ok: false, error: "not_found" });
    expect(await submitWork(db(), { userId: f.freelancer, milestoneId: "x';--", ...good })).toEqual({ ok: false, error: "not_found" });
    expect(await db().select().from(s.submissions)).toHaveLength(0);
  });

  it("refuses an AGREED (unfunded) milestone", async () => {
    expect(await submit()).toEqual({ ok: false, error: "wrong_state" });
    expect((await milestone()).state).toBe("AGREED");
  });

  it("rejects bad repo URLs, SHAs and deploy URLs", async () => {
    await fund(db(), f.milestoneId);
    for (const repoUrl of ["https://github.com/a/b; curl evil", "http://github.com/a/b", "https://gitlab.com/a/b", "https://github.com/a", "https://github.com/a/b/tree/main", "https://github.com/../b", "https://github.com/a/b\n"]) {
      expect(await submit({ repoUrl }), repoUrl).toEqual({ ok: false, error: "invalid_repo_url" });
    }
    for (const commitSha of ["a".repeat(39), `${"a".repeat(40)}\n`, "HEAD;id", "g".repeat(40), `${"a".repeat(39)}\nb`]) {
      expect(await submit({ commitSha }), commitSha).toEqual({ ok: false, error: "invalid_sha" });
    }
    for (const deployUrl of ["javascript:alert(1)", "http://example.com", "https://169.254.169.254/latest", "https://127.0.0.1", "https://localhost:3000", "https://10.0.0.5/x", "https://2130706433/", "https://metadata.google.internal/", "https://user:pw@example.com/", "https://example.com:8443/", "https://example.com/a b", "https://intranet/"]) {
      expect(await submit({ deployUrl }), deployUrl).toEqual({ ok: false, error: "invalid_deploy_url" });
    }
    expect(await db().select().from(s.submissions)).toHaveLength(0);
    expect((await milestone()).state).toBe("FUNDED");
  });

  it("accepts an uppercase SHA by lower-casing it and a .git suffix by dropping it", async () => {
    await fund(db(), f.milestoneId);
    expect((await submit({ commitSha: "ABCDEF".padEnd(40, "0"), repoUrl: `${good.repoUrl}.git` })).ok).toBe(true);
    const [sub] = await db().select().from(s.submissions);
    expect(sub!.commitSha).toBe("abcdef".padEnd(40, "0"));
    expect(sub!.repoUrl).toBe(good.repoUrl);
  });

  it("resubmits from REPORT_READY, superseding the earlier submission", async () => {
    await fund(db(), f.milestoneId);
    const first = await submit();
    // The run lifecycle (Task 6) moves SUBMITTED -> VERIFYING -> REPORT_READY.
    for (const event of ["start_verification", "report_ready"] as const) {
      const m = await milestone();
      await transitionMilestone(db(), { milestoneId: f.milestoneId, expectedState: m.state, expectedVersion: m.stateVersion, event });
    }
    const second = await submit({ commitSha: "b".repeat(40) });
    expect(second.ok).toBe(true);
    expect((await milestone()).state).toBe("SUBMITTED");
    const live = await db().select().from(s.submissions).where(and(eq(s.submissions.milestoneId, f.milestoneId), isNull(s.submissions.supersededAt)));
    expect(live.map((x) => x.commitSha)).toEqual(["b".repeat(40)]);
    const [old] = await db().select().from(s.submissions).where(eq(s.submissions.id, first.ok ? first.value.submissionId : ""));
    expect(old!.supersededAt).not.toBeNull();
    expect(await db().select().from(s.auditEvents).where(eq(s.auditEvents.action, "resubmitted"))).toHaveLength(1);
  });

  it("refuses a second submission while the first is SUBMITTED", async () => {
    await fund(db(), f.milestoneId);
    await submit();
    expect(await submit({ commitSha: "c".repeat(40) })).toEqual({ ok: false, error: "wrong_state" });
  });

  it("handles a guarded-transition conflict: of two concurrent submits exactly one wins", async () => {
    await fund(db(), f.milestoneId);
    const before = await milestone();
    const results = await Promise.all([submit(), submit({ commitSha: "d".repeat(40) })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: expect.stringMatching(/^(conflict|wrong_state)$/) });
    expect(await db().select().from(s.submissions)).toHaveLength(1);
    expect((await milestone()).stateVersion).toBe(before.stateVersion + 1);
    expect(await verifyChain(db(), f.projectId)).toMatchObject({ ok: true });
  });
});

describe("checkDeployUrl", () => {
  it("accepts a public https host and normalises nothing away", () => {
    expect(checkDeployUrl("https://arbiter-demo-pass.onrender.com")).toBe("https://arbiter-demo-pass.onrender.com");
    expect(checkDeployUrl("https://example.com/app/")).toBe("https://example.com/app/");
    expect(checkDeployUrl("https://192.168.1.1")).toBeNull();
    expect(checkDeployUrl("https://foo.localhost")).toBeNull();
  });
});
