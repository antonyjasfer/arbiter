// The verification read model: the milestone panel, the report page, and latestVerdicts for the Phase 5
// payment guard (wired in Phase 6). Members only; anything else is not_found (the demo boundary is enforced
// by requireProjectRole). A report always comes from the latest completed run of the live submission.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { requireProjectRole, type ProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { acceptanceCriteria, checkResults, evidence, milestones, submissions, verificationRuns } from "../db/schema";
import type { InjectionFlag } from "./injection-scan";
import { milestoneProject } from "./submissions";

export type VerdictSource = "deterministic" | "freelancer_suite" | "human_review";
export type ReportEvidence = { id: string; type: "screenshot" | "results" | "run_link" | "log" | "diff"; label: string | null; uri: string; stored: boolean };
export type ReportCriterion = {
  key: string;
  text: string;
  kind: string;
  verdict: "pass" | "fail" | "needs_review";
  source: VerdictSource;
  detail: unknown;
  aiSummary: string | null;
  evidence: ReportEvidence[];
  /** The checks Arbiter ran for this criterion (DSL steps from the run's plan). */
  steps: Record<string, unknown>[];
};
export type Report = {
  projectId: string;
  milestone: { id: string; title: string; position: number; state: string };
  submission: { repoUrl: string; commitSha: string; deployUrl: string; createdAt: Date };
  run: { id: string; runUrl: string | null; startedAt: Date | null; finishedAt: Date | null; createdAt: Date };
  injectionFlags: InjectionFlag[];
  criteria: ReportCriterion[];
  runEvidence: ReportEvidence[];
};

/** The badge for a verdict: a test-kind verdict is the freelancer's own suite, never an Arbiter-run check. */
export function sourceOf(kind: string, verdict: string): VerdictSource {
  if (verdict === "needs_review") return "human_review";
  return kind === "test" ? "freelancer_suite" : "deterministic";
}

async function member(db: Db, userId: string, milestoneId: string): Promise<{ projectId: string; role: ProjectRole; state: string } | null> {
  if (!parseId(milestoneId)) return null;
  const m = await milestoneProject(db, milestoneId);
  if (!m) return null;
  const role = await requireProjectRole(db, { userId, projectId: m.projectId, allowed: ["client", "freelancer"] });
  return role.ok ? { projectId: m.projectId, role: role.value.role, state: m.state } : null;
}

async function liveSubmission(db: Db, milestoneId: string) {
  const [sub] = await db.select().from(submissions).where(and(eq(submissions.milestoneId, milestoneId), isNull(submissions.supersededAt)));
  return sub ?? null;
}

async function latestCompletedRun(db: Db, submissionId: string) {
  const [run] = await db
    .select()
    .from(verificationRuns)
    .where(and(eq(verificationRuns.submissionId, submissionId), eq(verificationRuns.status, "completed")))
    .orderBy(desc(verificationRuns.createdAt))
    .limit(1);
  return run ?? null;
}

/** Phase 6 wires this into the payment guard: "the latest run has no FAIL". Null when there is no completed run. */
export async function latestVerdicts(db: Db, milestoneId: string): Promise<{ runId: string; verdicts: { criterionId: string; verdict: string }[]; hasFail: boolean } | null> {
  const sub = await liveSubmission(db, milestoneId);
  if (!sub) return null;
  const run = await latestCompletedRun(db, sub.id);
  if (!run) return null;
  const rows = await db.select({ criterionId: checkResults.criterionId, verdict: checkResults.verdict }).from(checkResults).where(eq(checkResults.runId, run.id));
  return { runId: run.id, verdicts: rows, hasFail: rows.some((r) => r.verdict === "fail") };
}

export type MilestonePanel = {
  role: ProjectRole;
  state: string;
  submission: { id: string; repoUrl: string; commitSha: string; deployUrl: string; createdAt: Date } | null;
  latestRun: { id: string; status: string; errorCode: string | null; runUrl: string | null; createdAt: Date } | null;
  hasReport: boolean;
};

export async function getMilestonePanel(db: Db, args: { userId: string; milestoneId: string }): Promise<Result<MilestonePanel, "not_found">> {
  const m = await member(db, args.userId, args.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  const sub = await liveSubmission(db, args.milestoneId);
  const [run] = sub ? await db.select().from(verificationRuns).where(eq(verificationRuns.submissionId, sub.id)).orderBy(desc(verificationRuns.createdAt)).limit(1) : [];
  const completed = sub ? await latestCompletedRun(db, sub.id) : null;
  return {
    ok: true,
    value: {
      role: m.role,
      state: m.state,
      submission: sub ? { id: sub.id, repoUrl: sub.repoUrl, commitSha: sub.commitSha, deployUrl: sub.deployUrl, createdAt: sub.createdAt } : null,
      latestRun: run ? { id: run.id, status: run.status, errorCode: run.errorCode, runUrl: run.runUrl, createdAt: run.createdAt } : null,
      hasReport: completed !== null,
    },
  };
}

export async function getReport(db: Db, args: { userId: string; milestoneId: string }): Promise<Result<Report | null, "not_found">> {
  const m = await member(db, args.userId, args.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  const sub = await liveSubmission(db, args.milestoneId);
  const run = sub ? await latestCompletedRun(db, sub.id) : null;
  if (!sub || !run) return { ok: true, value: null };
  const [ms] = await db.select({ id: milestones.id, title: milestones.title, position: milestones.position, state: milestones.state }).from(milestones).where(eq(milestones.id, args.milestoneId));
  const results = await db
    .select({ id: checkResults.id, verdict: checkResults.verdict, detail: checkResults.detail, aiSummary: checkResults.aiSummary, text: acceptanceCriteria.text, kind: acceptanceCriteria.kind, spec: acceptanceCriteria.specJson })
    .from(checkResults)
    .innerJoin(acceptanceCriteria, eq(acceptanceCriteria.id, checkResults.criterionId))
    .where(eq(checkResults.runId, run.id));
  const ev = await db
    .select({ id: evidence.id, checkResultId: evidence.checkResultId, type: evidence.type, label: evidence.label, uri: evidence.uri, hasContent: evidence.contentType })
    .from(evidence)
    .where(eq(evidence.runId, run.id))
    .orderBy(asc(evidence.createdAt));
  const toEv = (e: (typeof ev)[number]): ReportEvidence => ({ id: e.id, type: e.type, label: e.label, uri: e.uri, stored: e.hasContent !== null });
  const criteria = results
    .map((r) => {
      const key = (r.spec as { key?: string } | null)?.key ?? "";
      return {
        key,
        text: r.text,
        kind: r.kind,
        verdict: r.verdict,
        source: sourceOf(r.kind, r.verdict),
        detail: r.detail,
        aiSummary: r.aiSummary,
        evidence: ev.filter((e) => e.checkResultId === r.id).map(toEv),
        steps: ((run.plan as Record<string, { steps?: Record<string, unknown>[] }> | null)?.[key]?.steps ?? []).slice(0, 15),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  return {
    ok: true,
    value: {
      projectId: m.projectId,
      milestone: ms!,
      submission: { repoUrl: sub.repoUrl, commitSha: sub.commitSha, deployUrl: sub.deployUrl, createdAt: sub.createdAt },
      run: { id: run.id, runUrl: run.runUrl, startedAt: run.startedAt, finishedAt: run.finishedAt, createdAt: run.createdAt },
      injectionFlags: (sub.injectionFlags ?? []) as InjectionFlag[],
      criteria,
      runEvidence: ev.filter((e) => e.checkResultId === null).map(toEv),
    },
  };
}
