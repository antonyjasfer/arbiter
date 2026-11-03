// Arbiter's platform fee: 5% of the milestone plus $1.00, rounded half up to the cent (user decision,
// Phase 3). Phase 5 re-checks this against the PayPal fees measured in Phase 1.
export const FEE_PERCENT = 5;
export const FEE_FIXED_CENTS = 100;

export function feeFor(amountCents: number): { feeCents: number; payoutCents: number } {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new RangeError("feeFor: expected non-negative integer cents");
  const feeCents = Math.round((amountCents * FEE_PERCENT) / 100) + FEE_FIXED_CENTS;
  return { feeCents, payoutCents: amountCents - feeCents };
}
