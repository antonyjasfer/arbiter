"use client";

import { useActionState } from "react";
import { setPaypalEmailAction } from "@/app/(app)/projects/payment-actions";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/field";
import { errorText } from "@/lib/messages";

export function PaypalEmailForm({ email, isDemo }: { email: string | null; isDemo: boolean }) {
  const [state, action, pending] = useActionState(setPaypalEmailAction, null);
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <Label htmlFor="paypalEmail">Sandbox PayPal email for payouts</Label>
      <Input id="paypalEmail" name="paypalEmail" type="email" autoComplete="email" required maxLength={254} defaultValue={email ?? ""} disabled={isDemo} aria-invalid={state?.ok === false} />
      <FieldHint>
        {isDemo
          ? "Demo accounts use a seeded sandbox email, so this can't be changed."
          : "Use a PayPal sandbox personal account. Each payment keeps the email it was funded with; if you change it later, the client has to re-fund before Arbiter can pay you."}
      </FieldHint>
      {state?.ok === false ? <FieldError>{errorText(state.error)}</FieldError> : null}
      {state?.ok ? <p className="text-sm text-status-pass">Saved.</p> : null}
      <div>
        <Button type="submit" disabled={pending || isDemo}>
          {pending ? "Saving…" : "Save email"}
        </Button>
      </div>
    </form>
  );
}
