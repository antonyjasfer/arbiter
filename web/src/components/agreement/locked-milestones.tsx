import { MilestonePayment } from "@/components/payments/milestone-payment";
import { StatusBadge } from "@/components/ui/status-badge";
import { MilestoneVerification } from "@/components/verification/milestone-verification";
import { formatCents, type Tone } from "@/lib/format";
import type { ProjectRole } from "@/server/auth/roles";
import type { LockedMilestone } from "@/server/projects/workspace";

const STATE: Record<LockedMilestone["state"], { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "pending" },
  AGREED: { label: "Agreed, not funded", tone: "pending" },
  FUNDED: { label: "Funded", tone: "pass" },
  SUBMITTED: { label: "Submitted", tone: "pending" },
  VERIFYING: { label: "Verifying", tone: "pending" },
  REPORT_READY: { label: "Report ready", tone: "review" },
  APPROVED: { label: "Approved", tone: "pass" },
  CAPTURE_PENDING: { label: "Payment settling", tone: "review" },
  RELEASED: { label: "Payment captured", tone: "pass" },
  PAID: { label: "Paid", tone: "pass" },
  DISPUTED: { label: "Disputed", tone: "fail" },
  CANCELLED: { label: "Cancelled", tone: "fail" },
};

// The locked agreement's milestones, each with the Phase 4 (verification) and Phase 5 (payment) slots.
export function LockedMilestones({ projectId, milestones, role }: { projectId: string; milestones: LockedMilestone[]; role: ProjectRole }) {
  if (milestones.length === 0) return null;
  return (
    <section aria-labelledby="milestones-title" className="flex flex-col gap-3">
      <h2 id="milestones-title" className="text-lg font-semibold">
        Milestones
      </h2>
      <ol className="flex flex-col gap-3">
        {milestones.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {m.position}. {m.title} <span className="font-mono text-sm text-muted-foreground tabular-nums">{formatCents(m.amountCents)}</span>
              </p>
              <StatusBadge tone={STATE[m.state].tone}>{STATE[m.state].label}</StatusBadge>
            </div>
            <MilestoneVerification projectId={projectId} milestone={m} role={role} />
            <MilestonePayment projectId={projectId} milestone={m} role={role} />
          </li>
        ))}
      </ol>
    </section>
  );
}
