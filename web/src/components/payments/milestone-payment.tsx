import { FieldHint } from "@/components/ui/field";
import { formatCents } from "@/lib/format";
import type { ProjectRole } from "@/server/auth/roles";
import { serverEnv } from "@/server/env";
import type { LockedMilestone } from "@/server/projects/workspace";
import { FundButton } from "./fund-button";

// Phase 5 slot: funding, approval, capture and payout for one milestone.
export function MilestonePayment({ projectId, milestone, role }: { projectId: string; milestone: LockedMilestone; role: ProjectRole }) {
  if (milestone.state !== "AGREED") return null;
  if (role !== "client") return <FieldHint>Waiting for the client to fund this milestone with PayPal.</FieldHint>;
  // The PayPal client id is public by design (the browser SDK needs it); the secret never leaves the server.
  return <FundButton projectId={projectId} milestoneId={milestone.id} clientId={serverEnv().PAYPAL_CLIENT_ID} amountLabel={formatCents(milestone.amountCents)} />;
}
