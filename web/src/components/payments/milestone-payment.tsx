import type { ProjectRole } from "@/server/auth/roles";
import type { LockedMilestone } from "@/server/projects/workspace";

// Phase 5 slot: funding, approval, capture and payout for one milestone. Owned by the
// phase-5-payments branch; renders nothing until then.
export function MilestonePayment(_props: { projectId: string; milestone: LockedMilestone; role: ProjectRole }) {
  return null;
}
