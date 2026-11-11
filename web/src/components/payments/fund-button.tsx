"use client";

// The client funds one milestone with the PayPal JS SDK v6 button. The SDK opens PayPal's own window; the
// buyer's credentials never touch Arbiter. On approval the server authorizes the order (a hold, not a charge).
// Sources (checked 5 Nov 2026): https://developer.paypal.com/sdk/js/set-up/ (sandbox core script,
// createInstance with clientId and components ["paypal-payments"]) and https://developer.paypal.com/sdk/js/reference
// (findEligibleMethods, createPayPalOneTimePaymentSession with onApprove/onCancel/onError,
// session.start({ presentationMode: "auto" }, Promise<{ orderId }>), the <paypal-button> element).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeFundingAction, startFundingAction } from "@/app/(app)/projects/payment-actions";
import { FieldError, FieldHint } from "@/components/ui/field";
import { errorText } from "@/lib/messages";

// Sandbox only (CLAUDE.md rule 8).
const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

type PaymentSession = { start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void> };
type SdkInstance = {
  findEligibleMethods(args: { currencyCode: string }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(callbacks: {
    onApprove(data: { orderId: string }): Promise<void>;
    onCancel(): void;
    onError(error: { code?: string; message?: string }): void;
  }): PaymentSession;
};
type PaypalNamespace = { createInstance(args: { clientId: string; components: string[]; pageType?: string }): Promise<SdkInstance> };

declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: "pay" | "checkout" | "buynow" | "subscribe"; hidden?: boolean };
    }
  }
}

let sdkScript: Promise<PaypalNamespace> | undefined;

function loadSdk(): Promise<PaypalNamespace> {
  sdkScript ??= new Promise<PaypalNamespace>((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("paypal_sdk_failed")));
    s.onerror = () => reject(new Error("paypal_sdk_failed"));
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    sdkScript = undefined;
    throw e;
  });
  return sdkScript;
}

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "busy" } | { kind: "unavailable" } | { kind: "error"; code: string };

export function FundButton({ projectId, milestoneId, clientId, amountLabel }: { projectId: string; milestoneId: string; clientId: string; amountLabel: string }) {
  const router = useRouter();
  const session = useRef<PaymentSession | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const paypal = await loadSdk();
        const sdk = await paypal.createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout" });
        const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (cancelled) return;
        if (!methods.isEligible("paypal")) return setStatus({ kind: "unavailable" });
        session.current = sdk.createPayPalOneTimePaymentSession({
          async onApprove({ orderId }) {
            const r = await completeFundingAction(projectId, milestoneId, orderId);
            if (!r.ok) return setStatus({ kind: "error", code: r.error });
            setStatus({ kind: "ready" });
            router.refresh();
          },
          onCancel() {
            setStatus({ kind: "error", code: "paypal_cancelled" });
          },
          onError() {
            setStatus({ kind: "error", code: "paypal_refused" });
          },
        });
        setStatus({ kind: "ready" });
      } catch {
        if (!cancelled) setStatus({ kind: "error", code: "paypal_sdk_failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, milestoneId, projectId, router]);

  async function onClick() {
    if (!session.current || status.kind === "busy") return;
    setStatus({ kind: "busy" });
    // The SDK opens the PayPal window inside this click and waits for the order id from the server.
    const order = startFundingAction(projectId, milestoneId).then((r) => {
      if (!r.ok) {
        setStatus({ kind: "error", code: r.error });
        throw new Error(r.error);
      }
      return { orderId: r.value.orderId };
    });
    try {
      await session.current.start({ presentationMode: "auto" }, order);
    } catch {
      setStatus((s) => (s.kind === "busy" ? { kind: "error", code: "paypal_refused" } : s));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldHint>
        Fund {amountLabel} with PayPal. This places a hold on your PayPal account; nothing is captured until you approve the delivered work.
      </FieldHint>
      {status.kind === "loading" ? <div className="h-11 w-full max-w-xs animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" aria-label="Loading PayPal" /> : null}
      {status.kind === "unavailable" ? <FieldError>PayPal isn&apos;t available for this browser or region.</FieldError> : null}
      <div className="max-w-xs" aria-busy={status.kind === "busy"}>
        <paypal-button type="pay" className="paypal-gold" hidden={status.kind === "loading" || status.kind === "unavailable"} onClick={onClick} />
      </div>
      {status.kind === "error" ? <FieldError>{errorText(status.code)}</FieldError> : null}
    </div>
  );
}
