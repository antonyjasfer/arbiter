// TEST-ONLY (Phase 5; Phase 6 deletes this file). Moves one FUNDED milestone to REPORT_READY so the local
// sandbox payment run can reach the client's approval before Phase 4's real verification is merged.
// It is a CLI only, never an HTTP route or server action. It refuses unless PAYPAL_ENVIRONMENT=SANDBOX and
// it is given an explicit milestone id. It writes a fixture submission and a completed run whose verdicts
// are all needs_review with a summary saying nothing was verified (never a PASS), moves the milestone
// through guarded transitions, and audits every step with testOnly: true. It never calls PayPal.
// Run from web/:  node --conditions=react-server --import tsx scripts/dev-report-ready.ts <milestoneId>
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { parseId } from "../src/lib/ids";
import type { Result } from "../src/lib/result";
import { appendAudit } from "../src/server/audit/audit";
import type { Db } from "../src/server/db/types";
import { acceptanceCriteria, checkResults, projectMembers, submissions, verificationRuns } from "../src/server/db/schema";
import { transitionMilestone } from "../src/server/milestones/transition";
import type { MilestoneEvent, MilestoneState } from "../src/server/milestones/state-machine";
import { loadMilestone } from "../src/server/payments/context";

const SCRIPT = "scripts/dev-report-ready.ts";
const SUMMARY = "Test-only: set by scripts/dev-report-ready.ts for the local sandbox payment run. No verification ran.";
// Clearly not a real submission: a placeholder repo, the reserved .invalid TLD and an all-zero commit.
const FIXTURE = { repoUrl: "https://github.com/arbiter-test-only/no-repo", commitSha: "0".repeat(40), deployUrl: "https://dev-report-ready.invalid/" };

type DevError = "not_sandbox" | "not_found" | "not_funded" | "conflict";
type DevResult = Result<{ state: MilestoneState }, DevError>;

export async function devReportReady(db: Db, args: { milestoneId: string; env: Record<string, string | undefined> }): Promise<DevResult> {
  if (args.env.PAYPAL_ENVIRONMENT !== "SANDBOX") return { ok: false, error: "not_sandbox" };
  if (!parseId(args.milestoneId)) return { ok: false, error: "not_found" };
  const m = await loadMilestone(db, args.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  if (m.state !== "FUNDED") return { ok: false, error: "not_funded" };
  const [fl] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, m.projectId), eq(projectMembers.role, "freelancer")));
  if (!fl) return { ok: false, error: "not_found" };

  const base = { testOnly: true, script: SCRIPT, milestoneId: m.id };
  return db
    .transaction(async (tx) => {
      let state = m.state;
      let version = m.stateVersion;
      const move = async (event: MilestoneEvent) => {
        const r = await transitionMilestone(tx, { milestoneId: m.id, expectedState: state, expectedVersion: version, event });
        if (!r.ok) throw new Error("conflict");
        state = r.value.state;
        version = r.value.stateVersion;
      };

      const [sub] = await tx.insert(submissions).values({ milestoneId: m.id, submittedBy: fl.userId, ...FIXTURE }).returning({ id: submissions.id });
      await move("submit");
      await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "submission_created", data: { ...base, submissionId: sub!.id } });

      const now = new Date();
      const [run] = await tx
        .insert(verificationRuns)
        .values({ submissionId: sub!.id, status: "completed", errorCode: "test_only", errorDetail: SUMMARY, startedAt: now, finishedAt: now })
        .returning({ id: verificationRuns.id });
      await move("start_verification");
      await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "verification_started", data: { ...base, runId: run!.id } });

      const criteria = await tx.select({ id: acceptanceCriteria.id }).from(acceptanceCriteria).where(eq(acceptanceCriteria.milestoneId, m.id));
      for (const c of criteria) {
        await tx.insert(checkResults).values({ runId: run!.id, criterionId: c.id, verdict: "needs_review", source: "deterministic", summary: SUMMARY });
      }
      await move("report_ready");
      await appendAudit(tx, { projectId: m.projectId, actorId: null, action: "verification_finished", data: { ...base, runId: run!.id, verdicts: criteria.map(() => "needs_review") } });
      return { ok: true as const, value: { state } };
    })
    .catch((e: unknown): DevResult => {
      if (e instanceof Error && e.message === "conflict") return { ok: false, error: "conflict" };
      throw e;
    });
}

async function main() {
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(path.resolve(process.cwd(), ".."), true, { info: () => {}, error: console.error }, true);
  const milestoneId = process.argv[2];
  if (!milestoneId) throw new Error("usage: scripts/dev-report-ready.ts <milestoneId>");
  const { getDb } = await import("../src/server/db/client");
  const r = await devReportReady(getDb(), { milestoneId, env: process.env });
  console.log(r.ok ? `milestone ${milestoneId} is now ${r.value.state} (test-only, audited)` : `refused: ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
