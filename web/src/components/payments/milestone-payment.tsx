import { FieldHint } from "@/components/ui/field";
import { formatCents } from "@/lib/format";
import type { ProjectRole } from "@/server/auth/roles";
import { getDb } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import { livePayment } from "@/server/payments/context";
import { buildTimeline } from "@/server/payments/timeline";
import { guardVerdicts } from "@/server/payments/verdicts";
import { moneyToCents } from "@/server/projects/money";
import type { LockedMilestone } from "@/server/projects/workspace";
import { FundButton } from "./fund-button";
import { PaymentTimeline } from "./payment-timeline";
import { ReleasePanel } from "./release-panel";

// Phase 5 slot: funding, approval, capture and payout for one milestone. The page only renders this for
// project members (getLockedMilestones checks the role).
export async function MilestonePayment({ projectId, milestone, role }: { projectId: string; milestone: LockedMilestone; role: ProjectRole }) {
  if (milestone.state === "AGREED") {
    if (role !== "client") return <FieldHint>Waiting for the client to fund this milestone with PayPal.</FieldHint>;
    // The PayPal client id is public by design (the browser SDK needs it); the secret never leaves the server.
    return <FundButton projectId={projectId} milestoneId={milestone.id} clientId={serverEnv().PAYPAL_CLIENT_ID} amountLabel={formatCents(milestone.amountCents)} />;
  }
  const db = getDb();
  const p = await livePayment(db, milestone.id);
  if (!p?.authorizationId) return null;
  const verdicts = await guardVerdicts(db)(milestone.id);
  const label = (money: string | null) => formatCents(money === null ? 0 : moneyToCents(money));
  // The (app) layout awaits connection(), so reading the clock here is request-time, not prerender-time.
  const timeline = buildTimeline(p, milestone.state, new Date());
  return (
    <div className="flex flex-col gap-3">
      <ReleasePanel
        projectId={projectId}
        milestoneId={milestone.id}
        paymentId={p.id}
        state={milestone.state}
        paymentStatus={p.status}
        isClient={role === "client"}
        hasFail={verdicts?.includes("fail") ?? false}
        amountLabel={label(p.amount)}
        feeLabel={label(p.fee)}
        payoutLabel={label(p.payoutAmount)}
      />
      <PaymentTimeline timeline={timeline} />
    </div>
  );
}
