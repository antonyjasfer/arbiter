import { requireUser } from "@/server/auth/session";
import type { ProjectRole } from "@/server/auth/roles";
import { getDb } from "@/server/db/client";
import type { LockedMilestone } from "@/server/projects/workspace";
import { getMilestonePanel } from "@/server/verification/report";
import { VerificationPanel } from "./verification-panel";

// Phase 4: submission, run status and the report link for one milestone (server part; the panel is a client
// component that submits, starts and polls). Nothing shows before the milestone is funded.
const SHOWN = new Set(["FUNDED", "SUBMITTED", "VERIFYING", "REPORT_READY", "APPROVED", "CAPTURE_PENDING", "RELEASED", "PAID", "DISPUTED"]);

export async function MilestoneVerification({ projectId, milestone }: { projectId: string; milestone: LockedMilestone; role: ProjectRole }) {
  if (!SHOWN.has(milestone.state)) return null;
  const user = await requireUser();
  if (!user.ok) return null;
  const r = await getMilestonePanel(getDb(), { userId: user.value.userId, milestoneId: milestone.id });
  if (!r.ok) return null;
  const p = r.value;
  return (
    <VerificationPanel
      projectId={projectId}
      milestoneId={milestone.id}
      role={p.role}
      state={p.state}
      submission={p.submission ? { ...p.submission, createdAt: p.submission.createdAt.toISOString() } : null}
      latestRun={p.latestRun ? { ...p.latestRun, createdAt: p.latestRun.createdAt.toISOString() } : null}
      hasReport={p.hasReport}
    />
  );
}
