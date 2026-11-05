import type { ProjectRole } from "@/server/auth/roles";
import type { LockedMilestone } from "@/server/projects/workspace";

// Phase 4 slot: submission, run status and the report link for one milestone. Owned by the
// phase-4-verification branch; renders nothing until then.
export function MilestoneVerification(_props: { projectId: string; milestone: LockedMilestone; role: ProjectRole }) {
  return null;
}
