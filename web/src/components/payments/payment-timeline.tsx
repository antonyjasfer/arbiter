import { StatusBadge } from "@/components/ui/status-badge";
import { formatCents, formatIst, type Tone } from "@/lib/format";
import type { PaymentTimeline as Timeline, StepStatus, TimelineNotice, TimelineStep } from "@/server/payments/timeline";

// One milestone's payment as four steps, each with PayPal's own id and status as last read back, the fee
// breakdown, and the notices the live status line doesn't already carry (honor period, lost or voided hold).
// Presentational only: the read model is built on the server by buildTimeline.

const STEP_LABEL: Record<TimelineStep["key"], string> = {
  hold: "PayPal hold placed",
  approved: "Client approved the work",
  captured: "Payment captured",
  paid: "Freelancer paid",
};

const STATUS: Record<StepStatus, { label: string; tone: Tone }> = {
  done: { label: "Done", tone: "pass" },
  current: { label: "In progress", tone: "review" },
  waiting: { label: "Not yet", tone: "pending" },
  problem: { label: "Problem", tone: "fail" },
};

function noticeText(n: TimelineNotice): string | null {
  switch (n.kind) {
    case "honor_period":
      return `PayPal guarantees the held funds until ${formatIst(n.honorEndsAt)} (3-day honor period). The hold itself stays open until ${formatIst(n.expiresAt)}.`;
    case "honor_period_over":
      return `PayPal's 3-day honor period is over: the hold stays open until ${formatIst(n.expiresAt)}, but PayPal no longer guarantees the funds are available.`;
    case "refund_needed":
      return "Re-fund needed: PayPal's hold on this milestone expired or was voided, so nothing can be captured and approval is blocked. Arbiter can't yet re-fund a milestone after work was submitted; contact support.";
    case "voided":
      return "The PayPal hold was voided. Nothing was charged.";
    case "capture_refunded":
      return "PayPal reports this payment was refunded or reversed. Arbiter never claws back a payout automatically; a person reviews it in PayPal.";
    // Capture pending, denied and payout problems are shown by the live status line above.
    default:
      return null;
  }
}

export function PaymentTimeline({ timeline }: { timeline: Timeline }) {
  const { fee, notice, checkedAt } = timeline;
  const text = notice ? noticeText(notice) : null;
  return (
    <section aria-label="Payment timeline" className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <ol className="flex flex-col gap-2">
        {timeline.steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span>{STEP_LABEL[s.key]}</span>
            <span className="flex flex-wrap items-center gap-2">
              {s.paypalId ? (
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {s.paypalId}
                  {s.paypalStatus ? ` · ${s.paypalStatus}` : ""}
                </span>
              ) : null}
              <StatusBadge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusBadge>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-sm tabular-nums">
        Milestone {formatCents(fee.amountCents)}; Arbiter fee {formatCents(fee.feeCents)} (5% + $1.00); freelancer receives {formatCents(fee.payoutCents)}.
      </p>
      {text ? (
        <p className="text-sm" role={notice?.kind === "refund_needed" ? "alert" : undefined}>
          {text}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {checkedAt ? `PayPal statuses as of ${formatIst(checkedAt)}.` : "PayPal statuses not read back yet."} Arbiter is not an escrow service; PayPal holds and moves the money.
      </p>
    </section>
  );
}
