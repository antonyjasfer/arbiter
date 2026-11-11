// The payment guard's verdict input, read through Phase 4's latestVerdicts: the check results of the latest
// completed run of the milestone's live submission. No submission, no completed run, or a run with no
// results is "no report" (null), which the guard refuses. A run still in progress leaves the milestone in
// VERIFYING, so the guard refuses it on state before reading verdicts.
import type { Db } from "../db/types";
import { latestVerdicts } from "../verification/report";
import type { LatestVerdicts, Verdict } from "./guard";

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(["pass", "fail", "needs_review"]);

/** Identity mapping, checked at runtime: any value outside the guard's three verdicts throws (fail closed). */
export function toGuardVerdicts(values: readonly string[]): Verdict[] {
  for (const v of values) if (!VERDICTS.has(v)) throw new Error("unexpected verification verdict");
  return values as Verdict[];
}

export function guardVerdicts(db: Db): LatestVerdicts {
  return async (milestoneId) => {
    const latest = await latestVerdicts(db, milestoneId);
    if (!latest || latest.verdicts.length === 0) return null;
    return toGuardVerdicts(latest.verdicts.map((r) => r.verdict));
  };
}
