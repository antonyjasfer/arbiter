import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PaypalEmailForm } from "@/components/payments/paypal-email-form";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getPaypalEmail } from "@/server/payments/payee";

async function Settings() {
  const user = await requireUser();
  if (!user.ok) redirect("/");
  const me = await getPaypalEmail(getDb(), user.value.userId);
  if (!me) redirect("/");
  return (
    <section aria-labelledby="payout-title" className="flex flex-col gap-4 rounded-xl border p-5">
      <h2 id="payout-title" className="font-semibold">
        Payouts
      </h2>
      <p className="text-sm text-muted-foreground">As a freelancer, you are paid with a PayPal Payout to this email once the client approves your milestone. Arbiter runs on the PayPal sandbox; no real money moves.</p>
      <PaypalEmailForm email={me.email} isDemo={me.isDemo} />
    </section>
  );
}

export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading settings" />}>
        <Settings />
      </Suspense>
    </>
  );
}
