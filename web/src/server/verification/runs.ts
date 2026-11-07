// Verification runs, persisted in verification_runs so a restart or cold start never loses one (the
// compile-jobs pattern). A step claims the run with one guarded UPDATE that takes a lease and bumps
// `attempts`; `attempts` is only the fencing token here (a run is claimed on every poll for up to
// DEADLINE_MS, so there is no attempt cap). No in-process timers: due runs advance on boot and on every
// status poll, at most once per POLL_MS.
//
// Steps, read from the row: not dispatched -> dispatch (startedAt is written BEFORE the POST, so a crash
// after it looks for the run instead of dispatching twice) -> find the run by its name (dispatch_key)
// -> poll until GitHub says the run is completed -> check the artifacts (verdicts.checkArtifacts) ->
// download results.json, bound to this run and plan -> write verdicts -> REPORT_READY.
// Any error ends the run as `errored` and moves the milestone VERIFYING -> SUBMITTED (run_errored).
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { canonicalJson } from "@/lib/canonical-json";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import type { StructuredAi } from "../ai/structured-ai";
import { appendAudit } from "../audit/audit";
import { requireProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { checkResults, milestones, submissions, verificationRuns } from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import { scanRepo } from "./injection-scan";
import { planEvidence, storeEvidence } from "./evidence";
import { checkPlanSchema, planHash, RESULTS_FILE, resultsSchema, type CheckPlan, type Results } from "./plan-dsl";
import { reviewRun } from "./reviewer";
import { loadCriteria, planChecks, type PlanError } from "./planner";
import type { Job, RunnerClient } from "./runner-client";
import { checkRepoUrl, milestoneProject } from "./submissions";
import { checkArtifacts, computeVerdicts, evaluateStatic, staticPaths, type CriterionVerdict, type ResultsInput, type StaticEvaluation } from "./verdicts";

export const LEASE_MS = 240_000;
export const POLL_MS = 15_000;
/** How long after the dispatch the run may take to appear in the runs list. */
export const FIND_WINDOW_MS = 120_000;
/**
 * Dispatch to completion. The plan's "10 minutes plus 2 minutes' grace" predates the sequential job order:
 * validate (2 min cap) + browser (10 min cap) + tests (10 min cap) + queueing. Measured 7 Nov: a full run
 * with a Render cold start took about 90 s, and the tests job alone can legitimately take its full 10 minutes.
 */
export const DEADLINE_MS = 25 * 60_000;

type Run = typeof verificationRuns.$inferSelect;
export type StartError = "not_found" | "forbidden" | "wrong_state" | "conflict" | "repo_not_public" | "github_error" | PlanError;
export type RunErrorCode = "dispatch_failed" | "run_not_found" | "deadline_exceeded" | "unexpected_artifacts" | "bad_results";

/** SUBMITTED -> VERIFYING for the milestone's live submission. Any project member may start it. */
export async function startVerification(
  db: Db,
  ai: StructuredAi,
  runner: RunnerClient,
  args: { userId: string; submissionId: string; now?: Date },
): Promise<Result<{ runId: string }, StartError>> {
  if (!parseId(args.submissionId)) return { ok: false, error: "not_found" };
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.id, args.submissionId), isNull(submissions.supersededAt)));
  if (!sub) return { ok: false, error: "not_found" };
  const m = await milestoneProject(db, sub.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  const role = await requireProjectRole(db, { userId: args.userId, projectId: m.projectId, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: "not_found" };
  if (m.state !== "SUBMITTED") return { ok: false, error: "wrong_state" };

  const repo = checkRepoUrl(sub.repoUrl);
  if (!repo) return { ok: false, error: "not_found" };
  const pub = await runner.isPublicRepo(repo.owner, repo.repo);
  if (!pub.ok) return { ok: false, error: "github_error" };
  if (!pub.value) return { ok: false, error: "repo_not_public" };

  // Injection scan: read via the GitHub API, never executed. Flags are evidence; they change no verdict.
  const scan = await scanRepo({
    listTree: () => runner.getRepoTree(repo.owner, repo.repo, sub.commitSha),
    getFiles: (paths) => runner.getRepoFiles(repo.owner, repo.repo, sub.commitSha, paths),
  });
  if (!scan.ok) return { ok: false, error: "github_error" };

  const plan = await planChecks(db, ai, { milestoneId: sub.milestoneId, userId: args.userId, now: args.now });
  if (!plan.ok) return plan;
  const now = args.now ?? new Date();

  return db.transaction(async (tx) => {
    const moved = await transitionMilestone(tx, { milestoneId: sub.milestoneId, expectedState: "SUBMITTED", expectedVersion: m.stateVersion, event: "start_verification" });
    if (!moved.ok) return { ok: false, error: moved.error === "conflict" ? "conflict" : "wrong_state" } as const;
    await tx.update(submissions).set({ injectionFlags: scan.value.flags, injectionScannedAt: now }).where(eq(submissions.id, sub.id));
    const [run] = await tx
      .insert(verificationRuns)
      .values({ submissionId: sub.id, requestedBy: args.userId, status: "queued", plan: plan.value.plan, planHash: plan.value.planHash, nextAttemptAt: now, createdAt: now })
      .returning({ id: verificationRuns.id });
    await appendAudit(tx, { projectId: m.projectId, actorId: args.userId, action: "verification_started", data: { milestoneId: sub.milestoneId, submissionId: sub.id, runId: run!.id, planHash: plan.value.planHash, planCached: plan.value.cached } });
    if (scan.value.flags.length) {
      await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "injection_flagged", data: { submissionId: sub.id, flags: scan.value.flags.length, truncated: scan.value.truncated } });
    }
    return { ok: true, value: { runId: run!.id } } as const;
  });
}

const due = (now: Date) =>
  and(inArray(verificationRuns.status, ["queued", "running"]), lte(verificationRuns.nextAttemptAt, now), or(isNull(verificationRuns.leaseUntil), lt(verificationRuns.leaseUntil, now)));

export async function claimRun(db: Db, runId: string, now: Date): Promise<Run | undefined> {
  const [r] = await db
    .update(verificationRuns)
    .set({ status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${verificationRuns.attempts} + 1` })
    .where(and(eq(verificationRuns.id, runId), due(now)))
    .returning();
  return r;
}

/** Only the holder of attempt `attempts` may write; anything else is a stale step. */
function mine(run: Run) {
  return and(eq(verificationRuns.id, run.id), eq(verificationRuns.status, "running"), eq(verificationRuns.attempts, run.attempts));
}

async function runContext(db: Db, run: Run) {
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, run.submissionId));
  const m = await milestoneProject(db, sub!.milestoneId);
  return { sub: sub!, projectId: m!.projectId };
}

async function moveMilestone(db: Db, milestoneId: string, event: "report_ready" | "run_errored") {
  const [m] = await db.select({ state: milestones.state, stateVersion: milestones.stateVersion }).from(milestones).where(eq(milestones.id, milestoneId));
  if (m?.state !== "VERIFYING") return; // nothing to move (never expected; the run row still records the outcome)
  const moved = await transitionMilestone(db, { milestoneId, expectedState: "VERIFYING", expectedVersion: m.stateVersion, event });
  if (!moved.ok) throw new Error(`milestone ${event}: ${moved.error}`); // rolls back; the next poll retries
}

async function errorRun(db: Db, run: Run, code: RunErrorCode, detail: string, now: Date) {
  const { sub, projectId } = await runContext(db, run);
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(verificationRuns)
      .set({ status: "errored", errorCode: code, errorDetail: detail.slice(0, 2000), leaseUntil: null, finishedAt: now })
      .where(mine(run))
      .returning({ id: verificationRuns.id });
    if (!done) return;
    await moveMilestone(tx, sub.milestoneId, "run_errored");
    await appendAudit(tx, { projectId, actorId: null, action: "verification_errored", data: { milestoneId: sub.milestoneId, runId: run.id, code } });
  });
}

function jobsSummary(jobs: Job[]) {
  return jobs.map((j) => ({ name: j.name.slice(0, 50), conclusion: j.conclusion, startedAt: j.startedAt, completedAt: j.completedAt, steps: j.steps.map((s) => ({ name: s.name.slice(0, 100), conclusion: s.conclusion })) }));
}

async function finish(
  db: Db,
  run: Run,
  plan: CheckPlan,
  verdicts: Record<string, CriterionVerdict>,
  jobs: Job[],
  now: Date,
  artifact: { files: Record<string, Uint8Array>; results: Results | null },
): Promise<boolean> {
  const { sub, projectId } = await runContext(db, run);
  const criteria = await loadCriteria(db, sub.milestoneId);
  return db.transaction(async (tx) => {
    const [held] = await tx.select({ id: verificationRuns.id }).from(verificationRuns).where(mine(run)).for("update");
    if (!held) return false; // lease was taken over; the newer step will write
    const keyOf = new Map(criteria.map((c) => [c.id, c.key]));
    const rows = criteria.filter((c) => verdicts[c.key]).map((c) => ({ runId: run.id, criterionId: c.id, verdict: verdicts[c.key]!.verdict, source: verdicts[c.key]!.source, detail: verdicts[c.key]!.detail }));
    const inserted = rows.length ? await tx.insert(checkResults).values(rows).returning({ id: checkResults.id, criterionId: checkResults.criterionId }) : [];
    const checkResultIdByKey = Object.fromEntries(inserted.map((r) => [keyOf.get(r.criterionId)!, r.id]));
    await storeEvidence(tx, planEvidence({ runId: run.id, runUrl: run.runUrl, files: artifact.files, results: artifact.results, checkResultIdByKey }).rows);
    await tx.update(verificationRuns).set({ status: "completed", jobsSummary: jobsSummary(jobs), errorCode: null, errorDetail: null, leaseUntil: null, finishedAt: now }).where(mine(run));
    await moveMilestone(tx, sub.milestoneId, "report_ready");
    const count = (v: string) => rows.filter((r) => r.verdict === v).length;
    await appendAudit(tx, { projectId, actorId: null, action: "verification_finished", data: { milestoneId: sub.milestoneId, runId: run.id, pass: count("pass"), fail: count("fail"), needsReview: count("needs_review"), planKeys: Object.keys(plan).length } });
    return true;
  });
}

const TRANSIENT = new Set(["github_error", "rate_limited"]);

/** Returns true only when this step wrote the run's verdicts. */
async function advance(db: Db, runner: RunnerClient, run: Run, now: Date): Promise<boolean | void> {
  const later = () => db.update(verificationRuns).set({ leaseUntil: null, nextAttemptAt: new Date(now.getTime() + POLL_MS) }).where(mine(run));
  const parsedPlan = checkPlanSchema.safeParse(run.plan);
  if (!parsedPlan.success || planHash(parsedPlan.data) !== run.planHash) return errorRun(db, run, "dispatch_failed", "stored plan is invalid", now);
  const plan = parsedPlan.data;

  if (run.workflowRunId === null) {
    if (run.startedAt === null) {
      const { sub } = await runContext(db, run);
      // Record the dispatch first: if this process dies after the POST, the resumed step looks for the run.
      const [marked] = await db.update(verificationRuns).set({ startedAt: now }).where(mine(run)).returning({ id: verificationRuns.id });
      if (!marked) return;
      const d = await runner.dispatchVerify({
        runName: run.dispatchKey,
        repoUrl: sub.repoUrl,
        sha: sub.commitSha,
        deployUrl: sub.deployUrl,
        // The exact bytes whose sha256 is planHash, so results.plan_sha256 can be checked against it.
        planB64: Buffer.from(canonicalJson(plan), "utf8").toString("base64"),
      });
      // A network error or rate limit is ambiguous (the dispatch may have landed): look for the run instead.
      if (!d.ok && !TRANSIENT.has(d.error)) return errorRun(db, run, "dispatch_failed", d.error, now);
      await later();
      return;
    }
    const found = await runner.findRunByName(run.dispatchKey, run.startedAt);
    if (found.ok && found.value) {
      await db
        .update(verificationRuns)
        .set({ workflowRunId: found.value.id, runUrl: found.value.htmlUrl, deadlineAt: new Date(run.startedAt.getTime() + DEADLINE_MS), leaseUntil: null, nextAttemptAt: new Date(now.getTime() + POLL_MS) })
        .where(mine(run));
      return;
    }
    if (now.getTime() - run.startedAt.getTime() > FIND_WINDOW_MS) return errorRun(db, run, "run_not_found", "no workflow run carries the dispatch key", now);
    await later();
    return;
  }

  const runId = run.workflowRunId;
  const overdue = run.deadlineAt !== null && now.getTime() > run.deadlineAt.getTime();
  const gh = await runner.getRun(runId);
  if (!gh.ok || gh.value.status !== "completed") {
    if (overdue) return errorRun(db, run, "deadline_exceeded", gh.ok ? `run status ${gh.value.status}` : gh.error, now);
    await later();
    return;
  }

  // The whole run has completed, so no job can upload any more: now the artifact set can be judged.
  const jobs = await runner.getJobs(runId);
  const artifacts = await runner.listArtifacts(runId);
  if (!jobs.ok || !artifacts.ok) return overdue ? errorRun(db, run, "deadline_exceeded", "GitHub unavailable", now) : void (await later());
  const check = checkArtifacts(jobs.value, artifacts.value);
  if (check.kind === "rejected") return errorRun(db, run, check.error_code, check.detail, now);

  let results: ResultsInput;
  let artifactFiles: Record<string, Uint8Array> = {};
  if (check.kind === "missing") results = check;
  else {
    const files = await runner.downloadArtifact(runId, check.artifact.id);
    if (!files.ok) {
      if (TRANSIENT.has(files.error) && !overdue) return void (await later());
      return errorRun(db, run, "bad_results", `download: ${files.error}`, now);
    }
    const raw = files.value[RESULTS_FILE];
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
    } catch {
      parsed = null;
    }
    const r = resultsSchema.safeParse(parsed);
    if (!r.success) return errorRun(db, run, "bad_results", "results.json is missing or invalid", now);
    if (r.data.run_name !== run.dispatchKey || r.data.plan_sha256 !== run.planHash) return errorRun(db, run, "bad_results", "results.json is for another run or plan", now);
    results = { kind: "accepted", results: r.data };
    artifactFiles = files.value;
  }

  // Static checks: files read at the pinned commit through the GitHub API, never executed.
  const staticResults: Record<string, StaticEvaluation> = {};
  const staticKeys = Object.keys(plan).filter((k) => plan[k]!.kind === "static");
  if (staticKeys.length) {
    const { sub } = await runContext(db, run);
    const repo = checkRepoUrl(sub.repoUrl)!;
    const paths = [...new Set(staticKeys.flatMap((k) => staticPaths(plan[k]!)))];
    const got = await runner.getRepoFiles(repo.owner, repo.repo, sub.commitSha, paths);
    if (!got.ok) return overdue ? errorRun(db, run, "deadline_exceeded", `static files: ${got.error}`, now) : void (await later());
    const files = Object.fromEntries(got.value.map((x) => [x.path, x.content]));
    for (const k of staticKeys) staticResults[k] = evaluateStatic(plan[k]!, files);
  }

  return finish(db, run, plan, computeVerdicts(plan, jobs.value, results, staticResults), jobs.value, now, {
    files: artifactFiles,
    results: results.kind === "accepted" ? results.results : null,
  });
}

/**
 * Advances one run by at most one step, if it is due. Safe to call from any number of pollers. With `ai`,
 * the step that writes the verdicts then asks the Evidence Reviewer for summaries (once; a failure leaves
 * ai_summary null and the report still loads).
 */
export async function runStep(db: Db, runner: RunnerClient, runId: string, clock: () => Date = () => new Date(), ai?: StructuredAi): Promise<void> {
  const run = await claimRun(db, runId, clock());
  if (!run) return;
  try {
    const finished = await advance(db, runner, run, clock());
    if (finished && ai) {
      const r = await reviewRun(db, ai, { runId: run.id, now: clock() });
      if (!r.ok) console.error("evidence reviewer skipped:", r.error);
    }
  } catch (e) {
    // Release the lease so the next poll retries; never log request details or tokens.
    await db
      .update(verificationRuns)
      .set({ leaseUntil: null, nextAttemptAt: new Date(clock().getTime() + POLL_MS) })
      .where(mine(run))
      .catch(() => {});
    console.error("verification step failed:", e instanceof Error ? e.message.slice(0, 200) : "error");
  }
}

/** Advances every due run (boot and status polls). */
export async function resumeDueRuns(db: Db, runner: RunnerClient, clock: () => Date = () => new Date(), ai?: StructuredAi): Promise<number> {
  const rows = await db.select({ id: verificationRuns.id }).from(verificationRuns).where(due(clock())).limit(5);
  for (const { id } of rows) await runStep(db, runner, id, clock, ai);
  return rows.length;
}

export type RunStatus = Pick<Run, "id" | "status" | "errorCode" | "runUrl" | "startedAt" | "finishedAt" | "createdAt"> & { milestoneId: string };

/** A run's status, for project members only; anything else is "not_found". */
export async function getRunStatus(db: Db, args: { userId: string; runId: string }): Promise<Result<RunStatus, "not_found">> {
  if (!parseId(args.runId)) return { ok: false, error: "not_found" };
  const [r] = await db.select().from(verificationRuns).where(eq(verificationRuns.id, args.runId));
  if (!r) return { ok: false, error: "not_found" };
  const { sub, projectId } = await runContext(db, r);
  const role = await requireProjectRole(db, { userId: args.userId, projectId, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: "not_found" };
  return { ok: true, value: { id: r.id, status: r.status, errorCode: r.errorCode, runUrl: r.runUrl, startedAt: r.startedAt, finishedAt: r.finishedAt, createdAt: r.createdAt, milestoneId: sub.milestoneId } };
}
