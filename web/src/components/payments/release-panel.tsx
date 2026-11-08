"use client";

// The client's approve button (with a written override when a check failed) and the payment's live status.
// On each page view, and every 15 s while PayPal is settling or paying, it asks the server to reconcile
// the payment from PayPal (GET /api/payments/:id); the server decides what moves, never the browser.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveReleaseAction, cancelFundingAction } from "@/app/(app)/projects/payment-actions";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Label, Textarea } from "@/components/ui/field";
import { errorText } from "@/lib/messages";

const APPROVABLE = new Set(["REPORT_READY", "DISPUTED", "APPROVED"]);
const SETTLING = new Set(["CAPTURE_PENDING", "RELEASED"]);
const POLL_MS = 15_000;

type Props = {
  projectId: string;
  milestoneId: string;
  paymentId: string;
  state: string;
  paymentStatus: string;
  isClient: boolean;
  hasFail: boolean;
  amountLabel: string;
  feeLabel: string;
  payoutLabel: string;
};

function statusLine(state: string, paymentStatus: string, p: Props): string {
  if (paymentStatus === "payout_failed" || paymentStatus === "payout_unknown") return errorText(paymentStatus);
  if (paymentStatus === "authorization_lost") return "PayPal's hold expired or was voided, so this milestone can't be released. Re-funding after work was submitted isn't supported yet; contact support.";
  if (paymentStatus === "voided" || state === "CANCELLED") return "Cancelled. The PayPal hold was voided and nothing was charged.";
  if (paymentStatus === "capture_denied") return "PayPal declined the capture, so nothing was charged and the freelancer wasn't paid. Contact support.";
  switch (state) {
    case "APPROVED":
      return "Approved. Arbiter is capturing the payment with PayPal.";
    case "CAPTURE_PENDING":
      return "PayPal is settling this payment; Arbiter pays the freelancer once it completes.";
    case "RELEASED":
      return `Payment captured. Arbiter is paying the freelancer ${p.payoutLabel} through PayPal.`;
    case "PAID":
      return `Paid. The freelancer received ${p.payoutLabel} (milestone ${p.amountLabel}, Arbiter fee ${p.feeLabel}).`;
    default:
      return `Funded. PayPal is holding ${p.amountLabel}; nothing is captured until the client approves the delivered work.`;
  }
}

export function ReleasePanel(props: Props) {
  const router = useRouter();
  const [state, setState] = useState(props.state);
  const [paymentStatus, setPaymentStatus] = useState(props.paymentStatus);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/payments/${props.paymentId}`, { cache: "no-store" });
        if (res.ok) {
          const v = (await res.json()) as { state: string; paymentStatus: string };
          if (stopped) return;
          setState(v.state);
          setPaymentStatus(v.paymentStatus);
          if (v.state !== props.state || v.paymentStatus !== props.paymentStatus) router.refresh();
          if (!SETTLING.has(v.state) || v.paymentStatus === "payout_failed" || v.paymentStatus === "payout_unknown") return;
        }
      } catch {
        // Offline or the server is waking up: try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [props.paymentId, props.state, props.paymentStatus, router]);

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveReleaseAction(props.projectId, props.milestoneId, props.hasFail ? reason : null);
      if (!r.ok) return setError(r.error);
      setState(r.value.state);
      router.refresh();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const r = await cancelFundingAction(props.projectId, props.milestoneId);
      setConfirmCancel(false);
      if (!r.ok) return setError(r.error);
      setState(r.value.state);
      router.refresh();
    });
  }

  const canCancel = props.isClient && state === "FUNDED" && paymentStatus === "authorized";
  const canApprove = props.isClient && APPROVABLE.has(state) && paymentStatus !== "capture_denied" && paymentStatus !== "authorization_lost";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" role="status" aria-live="polite">
        {statusLine(state, paymentStatus, props)}
      </p>
      {canApprove ? (
        <div className="flex max-w-md flex-col gap-2">
          <FieldHint>
            Approving captures {props.amountLabel} from the PayPal hold and pays the freelancer {props.payoutLabel} (Arbiter&apos;s fee is {props.feeLabel}: 5% + $1.00).
          </FieldHint>
          {props.hasFail ? (
            <>
              <Label htmlFor={`override-${props.milestoneId}`}>A check failed. Why are you releasing anyway?</Label>
              <Textarea id={`override-${props.milestoneId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} rows={3} />
            </>
          ) : null}
          <div>
            <Button type="button" onClick={approve} disabled={pending}>
              {pending ? "Releasing…" : state === "APPROVED" ? "Retry capture" : "Approve and release payment"}
            </Button>
          </div>
        </div>
      ) : null}
      {canCancel ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirmCancel ? (
            <>
              <FieldHint>Cancel this milestone? PayPal releases the hold and nothing is charged. This can&apos;t be undone.</FieldHint>
              <Button type="button" variant="destructive" onClick={cancel} disabled={pending}>
                {pending ? "Cancelling…" : "Yes, cancel and release the hold"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmCancel(false)} disabled={pending}>
                Keep it funded
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setConfirmCancel(true)}>
              Cancel milestone
            </Button>
          )}
        </div>
      ) : null}
      {error ? <FieldError>{errorText(error)}</FieldError> : null}
    </div>
  );
}
