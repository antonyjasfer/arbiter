import { describe, expect, it } from "vitest";
import type { CheckPlan, Results } from "./plan-dsl";
import type { Artifact, Job } from "./runner-client";
import { checkArtifacts, computeVerdicts, evaluateStatic, UPLOAD_STEP } from "./verdicts";

// Shapes as the Jobs and Artifacts APIs returned them in the Phase 4 smoke run (2026-11-07).
const step = (number: number, name: string, conclusion: string | null = "success") => ({ number, name, status: "completed", conclusion });
function jobs(o: { browser?: string | null; upload?: string | null; tests?: string | null; testsStartedAt?: string | null; npmTest?: string | null } = {}): Job[] {
  return [
    { id: 1, name: "validate", status: "completed", conclusion: "success", startedAt: "2026-11-07T13:03:05Z", completedAt: "2026-11-07T13:03:08Z", steps: [step(1, "Set up job"), step(2, "validate inputs"), step(3, "Complete job")] },
    {
      id: 2,
      name: "browser",
      status: "completed",
      conclusion: o.browser === undefined ? "success" : o.browser,
      startedAt: "2026-11-07T13:03:15Z",
      completedAt: "2026-11-07T13:04:35Z",
      steps: [step(1, "Set up job"), step(2, "fetch interpreter"), step(3, "install playwright"), step(4, "run plan"), step(5, UPLOAD_STEP, o.upload === undefined ? "success" : o.upload), step(6, "Complete job")],
    },
    {
      id: 3,
      name: "tests",
      status: "completed",
      conclusion: o.tests === undefined ? "success" : o.tests,
      startedAt: o.testsStartedAt === undefined ? "2026-11-07T13:04:38Z" : o.testsStartedAt,
      completedAt: "2026-11-07T13:04:43Z",
      steps: [step(1, "Set up job"), step(2, "fetch"), step(3, "npm ci"), step(4, "npm test", o.npmTest === undefined ? "success" : o.npmTest), step(5, "Complete job")],
    },
  ];
}
const art = (id: number, name: string, createdAt: string, expired = false): Artifact => ({ id, name, createdAt, sizeInBytes: 1000, expired });
const RESULTS = art(10, "arbiter-results", "2026-11-07T13:04:33Z");

describe("checkArtifacts", () => {
  it("accepts exactly one arbiter-results created before the tests job started", () => {
    expect(checkArtifacts(jobs(), [RESULTS])).toEqual({ kind: "accepted", artifact: RESULTS });
  });

  it("accepts it when the tests job never started (no untrusted code ran)", () => {
    expect(checkArtifacts(jobs({ tests: "skipped", testsStartedAt: null }), [RESULTS])).toEqual({ kind: "accepted", artifact: RESULTS });
  });

  it("rejects any other artifact name", () => {
    const r = checkArtifacts(jobs(), [RESULTS, art(11, "my-results", "2026-11-07T13:04:40Z")]);
    expect(r).toMatchObject({ kind: "rejected", error_code: "unexpected_artifacts" });
  });

  it("rejects a second arbiter-results", () => {
    const r = checkArtifacts(jobs(), [RESULTS, art(11, "arbiter-results", "2026-11-07T13:04:40Z")]);
    expect(r).toMatchObject({ kind: "rejected", error_code: "unexpected_artifacts" });
  });

  it("rejects a single arbiter-results created after (or at) the tests job's start", () => {
    for (const at of ["2026-11-07T13:04:40Z", "2026-11-07T13:04:38Z"]) {
      expect(checkArtifacts(jobs(), [art(12, "arbiter-results", at)])).toMatchObject({ kind: "rejected", error_code: "unexpected_artifacts" });
    }
  });

  it("rejects an artifact with no usable creation time", () => {
    expect(checkArtifacts(jobs(), [art(12, "arbiter-results", "")])).toMatchObject({ kind: "rejected", error_code: "unexpected_artifacts" });
  });

  // User decision, 7 Nov: a deletion must not downgrade browser FAILs to NEEDS HUMAN REVIEW.
  it("rejects a run whose upload step succeeded but has no arbiter-results (deleted)", () => {
    expect(checkArtifacts(jobs({ upload: "success" }), [])).toMatchObject({ kind: "rejected", error_code: "unexpected_artifacts" });
  });

  it("treats results as missing (not tampering) when the upload step itself did not succeed", () => {
    for (const upload of ["failure", "skipped", "cancelled", null]) {
      expect(checkArtifacts(jobs({ browser: "failure", upload }), [])).toEqual({ kind: "missing", reason: "upload_failed" });
    }
  });

  it("treats results as missing when the browser job has no upload step at all", () => {
    const js = jobs().map((j) => (j.name === "browser" ? { ...j, conclusion: "failure", steps: j.steps.slice(0, 2) } : j));
    expect(checkArtifacts(js, [])).toEqual({ kind: "missing", reason: "upload_failed" });
  });

  it("treats an expired results artifact as missing", () => {
    expect(checkArtifacts(jobs(), [art(10, "arbiter-results", "2026-11-07T13:04:33Z", true)])).toEqual({ kind: "missing", reason: "expired" });
  });
});

const PLAN: CheckPlan = {
  m1c1: { kind: "browser", steps: [{ op: "goto", path: "/" }, { op: "expect_text", text: "Buy milk" }] },
  m1c2: { kind: "browser", steps: [{ op: "goto", path: "/" }] },
  m1c3: { kind: "test", steps: [{ op: "npm_test" }] },
  m1c4: { kind: "review", steps: [] },
  m1c5: { kind: "static", steps: [{ op: "file_exists", path: "README.md" }] },
};
const pass = (index: number, op: "goto" | "expect_text" = "goto") => ({ index, op, status: "pass" as const, reason: null, ms: 10, actual_status: null, mismatched_keys: [], screenshot: null });
function results(criteria: Results["criteria"], status: Results["status"] = "ok"): Results {
  return { version: 1, run_name: "90dd55d7-40a8-4c87-9f2a-8959613c62ac", plan_sha256: "a".repeat(64), status, plan_error: null, warmup: { ok: true, attempts: 1, ms: 5, status: 200 }, criteria, screenshots_skipped: 0 };
}
const OK_RESULTS = results({
  m1c1: { status: "pass", failed_step: null, reason: null, steps: [pass(0), pass(1, "expect_text")] },
  m1c2: { status: "pass", failed_step: null, reason: null, steps: [pass(0)] },
});
const STATIC_OK = { m1c5: { verdict: "pass" as const, detail: { kind: "static" as const, failed_step: null, steps: [{ index: 0, status: "pass" as const }] } } };

describe("computeVerdicts", () => {
  it("passes everything that passed, and every verdict is deterministic", () => {
    const v = computeVerdicts(PLAN, jobs(), { kind: "accepted", results: OK_RESULTS }, STATIC_OK);
    expect(v.m1c1!.verdict).toBe("pass");
    expect(v.m1c2!.verdict).toBe("pass");
    expect(v.m1c3!.verdict).toBe("pass");
    expect(v.m1c5!.verdict).toBe("pass");
    expect(Object.values(v).every((x) => x.source === "deterministic")).toBe(true);
  });

  it("review criteria are always NEEDS HUMAN REVIEW, whatever else happened", () => {
    for (const r of [{ kind: "accepted" as const, results: OK_RESULTS }, { kind: "missing" as const, reason: "upload_failed" as const }]) {
      expect(computeVerdicts(PLAN, jobs(), r, STATIC_OK).m1c4).toMatchObject({ verdict: "needs_review", detail: { reason: "review_criterion" } });
    }
  });

  it("a failed tests job makes every test criterion FAIL, naming the failing step", () => {
    const v = computeVerdicts(PLAN, jobs({ tests: "failure", npmTest: "failure" }), { kind: "accepted", results: OK_RESULTS }, STATIC_OK);
    expect(v.m1c3).toMatchObject({ verdict: "fail", detail: { kind: "test", job_conclusion: "failure", failed_step: "npm test" } });
  });

  it("a tests job stopped by the 10-minute timeout is FAIL, never PASS", () => {
    const v = computeVerdicts(PLAN, jobs({ tests: "cancelled", npmTest: "cancelled" }), { kind: "accepted", results: OK_RESULTS }, STATIC_OK);
    expect(v.m1c3!.verdict).toBe("fail");
  });

  it("a tests job that never ran gives NEEDS HUMAN REVIEW for test criteria", () => {
    const v = computeVerdicts(PLAN, jobs({ tests: "skipped", testsStartedAt: null, npmTest: null }), { kind: "accepted", results: OK_RESULTS }, STATIC_OK);
    expect(v.m1c3).toMatchObject({ verdict: "needs_review", detail: { reason: "tests_not_run" } });
  });

  it("a failed browser step makes that criterion FAIL and records the failing step", () => {
    const r = results({
      m1c1: {
        status: "fail",
        failed_step: 1,
        reason: "not_found",
        steps: [pass(0), { index: 1, op: "expect_text", status: "fail", reason: "not_found", ms: 1500, actual_status: null, mismatched_keys: [], screenshot: "shots/1.jpg" }],
      },
      m1c2: { status: "pass", failed_step: null, reason: null, steps: [pass(0)] },
    });
    const v = computeVerdicts(PLAN, jobs(), { kind: "accepted", results: r }, STATIC_OK);
    expect(v.m1c1).toMatchObject({ verdict: "fail", detail: { kind: "browser", failed_step: 1, reason: "not_found" } });
    expect(v.m1c2!.verdict).toBe("pass");
  });

  it("missing results make browser criteria NEEDS HUMAN REVIEW with the reason; other kinds are unaffected", () => {
    const v = computeVerdicts(PLAN, jobs({ browser: "failure", upload: "failure" }), { kind: "missing", reason: "upload_failed" }, STATIC_OK);
    expect(v.m1c1).toMatchObject({ verdict: "needs_review", detail: { reason: "results_missing", why: "upload_failed" } });
    expect(v.m1c2!.verdict).toBe("needs_review");
    expect(v.m1c3!.verdict).toBe("pass");
  });

  // Proposed default (pending the user's decision): an unreachable or too-slow site is the freelancer's to fix,
  // so it must not escape a FAIL by taking the site down.
  it("an unreachable site, or a check that timed out, is FAIL", () => {
    for (const reason of ["site_unreachable", "budget_exhausted", "timeout"] as const) {
      const r = results({ m1c1: { status: "error", failed_step: null, reason, steps: [] }, m1c2: { status: "error", failed_step: null, reason, steps: [] } }, reason === "site_unreachable" ? "site_unreachable" : "ok");
      expect(computeVerdicts(PLAN, jobs(), { kind: "accepted", results: r }, STATIC_OK).m1c1).toMatchObject({ verdict: "fail", detail: { reason } });
    }
  });

  it("an interpreter error, a rejected plan or a criterion missing from results is NEEDS HUMAN REVIEW", () => {
    const err = results({ m1c1: { status: "error", failed_step: null, reason: "error", steps: [] } });
    const v = computeVerdicts(PLAN, jobs(), { kind: "accepted", results: err }, STATIC_OK);
    expect(v.m1c1).toMatchObject({ verdict: "needs_review", detail: { reason: "error" } });
    expect(v.m1c2).toMatchObject({ verdict: "needs_review", detail: { reason: "no_result" } });
    const invalid = computeVerdicts(PLAN, jobs(), { kind: "accepted", results: results({}, "plan_invalid") }, STATIC_OK);
    expect(invalid.m1c1).toMatchObject({ verdict: "needs_review", detail: { reason: "plan_invalid" } });
  });

  it("a static criterion with no evaluation is NEEDS HUMAN REVIEW", () => {
    expect(computeVerdicts(PLAN, jobs(), { kind: "accepted", results: OK_RESULTS }, {}).m1c5).toMatchObject({ verdict: "needs_review", detail: { reason: "no_result" } });
  });
});

describe("evaluateStatic", () => {
  const files = { "README.md": "# TaskBoard\nRun npm test.", "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "next build" } }) };
  const run = (steps: CheckPlan[string]["steps"]) => evaluateStatic({ kind: "static", steps } as CheckPlan[string], files);

  it("passes when every step holds", () => {
    expect(run([{ op: "file_exists", path: "README.md" }, { op: "file_contains", path: "README.md", text: "npm test" }, { op: "package_script_exists", script: "build" }])).toMatchObject({ verdict: "pass" });
  });

  it("fails on the first step that does not hold, and skips the rest", () => {
    const r = run([{ op: "file_exists", path: "README.md" }, { op: "file_exists", path: "LICENSE" }, { op: "file_exists", path: "README.md" }]);
    expect(r).toMatchObject({ verdict: "fail", detail: { failed_step: 1, steps: [{ status: "pass" }, { status: "fail" }, { status: "skipped" }] } });
  });

  it("an unparseable package.json fails package_script_exists", () => {
    const r = evaluateStatic({ kind: "static", steps: [{ op: "package_script_exists", script: "test" }] }, { "package.json": "{not json" });
    expect(r.verdict).toBe("fail");
  });

  it("an inherited name like toString is not a script", () => {
    expect(run([{ op: "package_script_exists", script: "toString" }]).verdict).toBe("fail");
  });
});
