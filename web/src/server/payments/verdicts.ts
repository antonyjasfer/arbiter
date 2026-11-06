// The guard's latest-verdicts input, read from the shared verification tables: the check results of the
// newest run of the milestone's live submission, if that run completed. Anything else (no submission, a
// run still going, an errored run, a run with no results) is "no report", which blocks release.
// Phase 6 may swap this for Phase 4's latestVerdicts; both read the same rows.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/types";
import { checkResults, submissions, verificationRuns } from "../db/schema";
import type { LatestVerdicts } from "./guard";

export function latestRunVerdicts(db: Db): LatestVerdicts {
  return async (milestoneId) => {
    const [latest] = await db
      .select({ id: verificationRuns.id, status: verificationRuns.status })
      .from(verificationRuns)
      .innerJoin(submissions, eq(submissions.id, verificationRuns.submissionId))
      .where(and(eq(submissions.milestoneId, milestoneId), isNull(submissions.supersededAt)))
      .orderBy(desc(verificationRuns.createdAt))
      .limit(1);
    if (!latest || latest.status !== "completed") return null;
    const rows = await db.select({ verdict: checkResults.verdict }).from(checkResults).where(eq(checkResults.runId, latest.id));
    return rows.length > 0 ? rows.map((r) => r.verdict) : null;
  };
}
