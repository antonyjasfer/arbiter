// Verdicts are deterministic only. They come from GitHub's Jobs API (job and step conclusions, which repo
// code cannot forge) and from the trusted browser job's results.json, accepted only through checkArtifacts.
// Nothing here reads model output, and review criteria are always NEEDS HUMAN REVIEW.
// Pure: no I/O, so every rule is unit-tested.
import type { CheckPlan, CriterionPlan, Results, StaticStep, StepResult } from "./plan-dsl";
import { RESULTS_ARTIFACT } from "./plan-dsl";
import type { Artifact, Job } from "./runner-client";

// Job and step names in arbiter-runner .github/workflows/verify.yml (pinned there by guard tests).
export const BROWSER_JOB = "browser";
export const TESTS_JOB = "tests";
export const UPLOAD_STEP = "upload results";

export type Verdict = "pass" | "fail" | "needs_review";

export type ArtifactCheck = { kind: "accepted"; artifact: Artifact } | { kind: "rejected"; error_code: "unexpected_artifacts" | "runner_error"; detail: string };

const at = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/**
 * Decides whether the run's artifacts can be trusted. Call only once the whole run has completed, since
 * until then the tests job could still upload. The forged-results defence (user, 5 Nov, and 7 Nov for
 * deletions): code in the tests job may reach the runner's artifact token, so anything other than exactly
 * one arbiter-results created before the tests job started is tampering, and so is a successful upload step
 * whose artifact has gone. Results are never downloaded from a rejected set.
 */
export function checkArtifacts(jobs: Job[], artifacts: Artifact[]): ArtifactCheck {
  const reject = (detail: string): ArtifactCheck => ({ kind: "rejected", error_code: "unexpected_artifacts", detail });
  const other = artifacts.filter((a) => a.name !== RESULTS_ARTIFACT);
  if (other.length) return reject(`unexpected artifact names: ${other.map((a) => JSON.stringify(a.name.slice(0, 60))).join(", ")}`);
  const named = artifacts.filter((a) => a.name === RESULTS_ARTIFACT);
  if (named.length > 1) return reject(`${named.length} ${RESULTS_ARTIFACT} artifacts`);

  const browser = jobs.find((j) => j.name === BROWSER_JOB);
  const upload = browser?.steps.find((s) => s.name === UPLOAD_STEP);
  if (named.length === 0) {
    // verify.yml uploads with if-no-files-found: error, so a successful upload step means the artifact existed.
    if (upload?.conclusion === "success") return reject(`${RESULTS_ARTIFACT} was uploaded but is gone`);
    // No results and no successful upload: the trusted job broke (user decision, 8 Nov: errored, never a verdict).
    return { kind: "rejected", error_code: "runner_error", detail: `no ${RESULTS_ARTIFACT}: ${firstFailedStep(browser) ?? "the browser job did not upload results"}` };
  }

  const a = named[0]!;
  const created = at(a.createdAt);
  if (Number.isNaN(created)) return reject(`${RESULTS_ARTIFACT} has no creation time`);
  const tests = jobs.find((j) => j.name === TESTS_JOB);
  const testsStarted = at(tests?.startedAt);
  // Timestamps are whole seconds, so "at the same second" counts as after: reject rather than guess.
  if (!Number.isNaN(testsStarted) && created >= testsStarted) return reject(`${RESULTS_ARTIFACT} was created after the tests job started`);
  if (a.expired) return { kind: "rejected", error_code: "runner_error", detail: `${RESULTS_ARTIFACT} has expired` };
  return { kind: "accepted", artifact: a };
}

function firstFailedStep(job: Job | undefined): string | null {
  const s = job?.steps.find((x) => x.conclusion !== null && x.conclusion !== "success" && x.conclusion !== "skipped");
  return s ? `${job!.name} step "${s.name.slice(0, 60)}" ${s.conclusion}` : null;
}

// The browser job's steps before the plan runs: Arbiter's own setup, which no freelancer code touches.
const TRUSTED_SETUP_STEPS = new Set(["Set up job", "fetch interpreter", "install playwright", "allow chromium sandbox"]);

/**
 * Runner infrastructure failures make the run errored (error_code runner_error), never a FAIL: the validate
 * job failing, any job missing, GitHub's "Set up job" failing, or the browser job's own setup (fetching the
 * interpreter, installing Playwright) failing. The freelancer's npm ci / npm test failing, or the tests job
 * hitting its 10-minute timeout, are verdicts, not infrastructure. Call once the run has completed.
 */
export function checkInfrastructure(jobs: Job[]): { error_code: "runner_error"; detail: string } | null {
  const err = (detail: string) => ({ error_code: "runner_error" as const, detail });
  const validate = jobs.find((j) => j.name === "validate");
  const browser = jobs.find((j) => j.name === BROWSER_JOB);
  const tests = jobs.find((j) => j.name === TESTS_JOB);
  if (!validate || !browser || !tests) return err(`missing job(s): ${["validate", BROWSER_JOB, TESTS_JOB].filter((n) => !jobs.some((j) => j.name === n)).join(", ")}`);
  if (validate.conclusion !== "success") return err(`validate job ${validate.conclusion ?? "did not finish"}`);
  for (const job of [browser, tests]) {
    const setup = job.steps.find((s) => s.name === "Set up job");
    if (setup && setup.conclusion !== "success") return err(`${job.name} step "Set up job" ${setup.conclusion ?? "did not finish"}`);
  }
  const broken = browser.steps.find((s) => TRUSTED_SETUP_STEPS.has(s.name) && s.conclusion !== "success");
  if (broken) return err(`${BROWSER_JOB} step "${broken.name}" ${broken.conclusion ?? "did not finish"}`);
  return null;
}

export type StaticStepOutcome = { index: number; status: "pass" | "fail" | "skipped" };
export type VerdictDetail =
  | { kind: "review"; reason: "review_criterion" }
  | { kind: "test"; job_conclusion: string | null; failed_step: string | null; reason?: "tests_not_run" }
  | { kind: "browser"; failed_step: number | null; reason: string | null; steps: StepResult[]; why?: string }
  | { kind: "static"; failed_step: number | null; steps: StaticStepOutcome[]; reason?: "no_result" };
export type CriterionVerdict = { verdict: Verdict; source: "deterministic"; detail: VerdictDetail };
export type StaticEvaluation = { verdict: "pass" | "fail"; detail: Extract<VerdictDetail, { kind: "static" }> };

export type ResultsInput = { kind: "accepted"; results: Results } | { kind: "missing"; reason: "upload_failed" | "expired" };

// An unreachable or too-slow site is the freelancer's to fix: it is a FAIL, so taking the site down cannot
// turn a FAIL into NEEDS HUMAN REVIEW (proposed default, pending the user's decision of 7 Nov).
const FREELANCER_SIDE_ERRORS = new Set(["site_unreachable", "budget_exhausted", "timeout"]);

function testVerdict(jobs: Job[]): CriterionVerdict {
  const tests = jobs.find((j) => j.name === TESTS_JOB);
  const conclusion = tests?.conclusion ?? null;
  if (!tests || !tests.startedAt || conclusion === null || conclusion === "skipped") {
    return { verdict: "needs_review", source: "deterministic", detail: { kind: "test", job_conclusion: conclusion, failed_step: null, reason: "tests_not_run" } };
  }
  // Only "success" is a PASS. failure, cancelled (the 10-minute timeout), timed_out and anything else fail.
  if (conclusion === "success") return { verdict: "pass", source: "deterministic", detail: { kind: "test", job_conclusion: conclusion, failed_step: null } };
  const failed = tests.steps.find((s) => s.conclusion !== null && s.conclusion !== "success" && s.conclusion !== "skipped");
  return { verdict: "fail", source: "deterministic", detail: { kind: "test", job_conclusion: conclusion, failed_step: failed?.name.slice(0, 100) ?? null } };
}

function browserVerdict(key: string, input: ResultsInput): CriterionVerdict {
  const review = (reason: string, why?: string, steps: StepResult[] = []): CriterionVerdict => ({
    verdict: "needs_review",
    source: "deterministic",
    detail: { kind: "browser", failed_step: null, reason, steps, ...(why ? { why } : {}) },
  });
  if (input.kind === "missing") return review("results_missing", input.reason);
  const r = input.results;
  if (r.status === "plan_invalid") return review("plan_invalid");
  const c = r.criteria[key];
  if (!c) return review("no_result");
  if (c.status === "pass") return { verdict: "pass", source: "deterministic", detail: { kind: "browser", failed_step: null, reason: null, steps: c.steps } };
  if (c.status === "fail" || (c.reason !== null && FREELANCER_SIDE_ERRORS.has(c.reason))) {
    return { verdict: "fail", source: "deterministic", detail: { kind: "browser", failed_step: c.failed_step, reason: c.reason, steps: c.steps } };
  }
  return review(c.reason ?? "error", undefined, c.steps);
}

/** One verdict per plan key. `staticResults` comes from evaluateStatic over files read via the GitHub API. */
export function computeVerdicts(plan: CheckPlan, jobs: Job[], results: ResultsInput, staticResults: Record<string, StaticEvaluation>): Record<string, CriterionVerdict> {
  const out: Record<string, CriterionVerdict> = {};
  for (const [key, cp] of Object.entries(plan)) {
    if (cp.kind === "review") out[key] = { verdict: "needs_review", source: "deterministic", detail: { kind: "review", reason: "review_criterion" } };
    else if (cp.kind === "test") out[key] = testVerdict(jobs);
    else if (cp.kind === "browser") out[key] = browserVerdict(key, results);
    else {
      const s = staticResults[key];
      out[key] = s
        ? { verdict: s.verdict, source: "deterministic", detail: s.detail }
        : { verdict: "needs_review", source: "deterministic", detail: { kind: "static", failed_step: null, steps: [], reason: "no_result" } };
    }
  }
  return out;
}

/** The repository paths a static plan reads (package.json for script checks). */
export function staticPaths(cp: CriterionPlan): string[] {
  if (cp.kind !== "static") return [];
  const paths = new Set<string>();
  for (const s of cp.steps) paths.add(s.op === "package_script_exists" ? "package.json" : s.path);
  return [...paths];
}

function staticStepHolds(step: StaticStep, files: Record<string, string>): boolean {
  if (step.op === "file_exists") return Object.hasOwn(files, step.path);
  if (step.op === "file_contains") return Object.hasOwn(files, step.path) && files[step.path]!.includes(step.text);
  const raw = Object.hasOwn(files, "package.json") ? files["package.json"]! : null;
  if (raw === null) return false;
  try {
    const pkg: unknown = JSON.parse(raw);
    const scripts = typeof pkg === "object" && pkg !== null ? (pkg as { scripts?: unknown }).scripts : undefined;
    return typeof scripts === "object" && scripts !== null && Object.hasOwn(scripts, step.script) && typeof (scripts as Record<string, unknown>)[step.script] === "string";
  } catch {
    return false;
  }
}

/** Evaluates a static plan over file contents read at the pinned commit (never executed). Stops at the first failure. */
export function evaluateStatic(cp: CriterionPlan, files: Record<string, string>): StaticEvaluation {
  const steps: StaticStepOutcome[] = [];
  let failed: number | null = null;
  const list = cp.kind === "static" ? cp.steps : [];
  list.forEach((step, index) => {
    if (failed !== null) steps.push({ index, status: "skipped" });
    else if (staticStepHolds(step, files)) steps.push({ index, status: "pass" });
    else {
      failed = index;
      steps.push({ index, status: "fail" });
    }
  });
  return { verdict: failed === null && list.length > 0 ? "pass" : "fail", detail: { kind: "static", failed_step: failed, steps } };
}
