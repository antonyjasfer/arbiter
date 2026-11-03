// Guarded state change: one UPDATE that only succeeds if nobody else moved the milestone first.
import { and, eq, sql } from "drizzle-orm";
import type { Result } from "@/lib/result";
import type { Db } from "../db/types";
import { milestones } from "../db/schema";
import { nextState, type MilestoneEvent, type MilestoneState } from "./state-machine";

export async function transitionMilestone(
  db: Db,
  args: { milestoneId: string; expectedState: MilestoneState; expectedVersion: number; event: MilestoneEvent },
): Promise<Result<{ state: MilestoneState; stateVersion: number }, "illegal_transition" | "conflict">> {
  const to = nextState(args.expectedState, args.event);
  if (!to.ok) return to;
  const rows = await db
    .update(milestones)
    .set({ state: to.value, stateVersion: sql`${milestones.stateVersion} + 1` })
    .where(
      and(
        eq(milestones.id, args.milestoneId),
        eq(milestones.state, args.expectedState),
        eq(milestones.stateVersion, args.expectedVersion),
      ),
    )
    .returning({ state: milestones.state, stateVersion: milestones.stateVersion });
  const row = rows[0];
  return row ? { ok: true, value: row } : { ok: false, error: "conflict" };
}
