// Phase 5 (payments) error codes -> plain-language text. Owned by the phase-5-payments branch.
export const PAYMENT_ERROR_TEXT: Record<string, string> = {
  not_agreed: "This milestone can't be funded now. Reload the page to see its current state.",
  payee_email_missing: "The freelancer hasn't added their PayPal email yet. Ask them to add it in Settings, then fund the milestone.",
  already_funded: "This milestone is already funded.",
  order_mismatch: "That PayPal order doesn't belong to this milestone. Reload the page and try again.",
  order_not_approved: "PayPal hasn't confirmed your approval. Nothing was charged; try the PayPal button again.",
  authorization_not_created: "PayPal didn't place the hold. Nothing was charged; try again or use another payment method in PayPal.",
  amount_mismatch: "PayPal reported a different amount than the milestone. Nothing was funded; contact support.",
  paypal_refused: "PayPal refused the request. Nothing was charged; try again.",
  paypal_unavailable: "PayPal didn't answer in time. Nothing was charged twice; try again and Arbiter will pick up where it left off.",
  conflict: "Someone else changed this milestone at the same moment. Reload the page.",
  paypal_sdk_failed: "The PayPal button couldn't load. Check your connection or ad blocker, then reload.",
  paypal_cancelled: "You closed PayPal before approving. Nothing was charged.",
};
