// SPIKE 1 (throwaway): PayPal sandbox AUTHORIZE order -> buyer approval -> authorize -> capture -> replay -> Payout.
// `--probe`: USD 5.00 order -> authorize -> reauthorize (expected to be rejected inside the honor period) -> void.
// Sources: PayPal Orders v2, Payments v2 and Payouts v1 REST references (developer.paypal.com/docs/api).
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForApproval } from "./lib/approval-server.js";
import { requireEnvOrExit } from "./lib/env.js";
import { getAccessToken, newRequestId, PayPalError, ppFetch } from "./lib/paypal.js";

const PORT = 3456;
const CAPTURE_AMOUNT = "50.00"; // demo milestones are 50 USD or more
const PLATFORM_FEE_PCT = 5;
const PROBE = process.argv.includes("--probe");

type Money = { currency_code?: string; currency?: string; value: string };
type Link = { href: string; rel: string; method?: string };
type Auth = { id: string; status: string; expiration_time?: string; create_time?: string };
type Order = { id: string; status: string; links?: Link[]; purchase_units?: { payments?: { authorizations?: Auth[] } }[] };
type Capture = {
  id: string;
  status: string;
  final_capture?: boolean;
  seller_receivable_breakdown?: { gross_amount?: Money; paypal_fee?: Money; net_amount?: Money };
};
type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string; fees?: Money; amount?: Money };
  items?: { transaction_status?: string; payout_item_fee?: Money; payout_item_id?: string; errors?: { name?: string; message?: string } }[];
};

const toCents = (v: string) => Math.round(parseFloat(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const requestIds: Record<string, string> = {};
const run: Record<string, unknown> = { startedAt: new Date().toISOString(), mode: PROBE ? "probe" : "main", requestIds };

function newRid(label: string): string {
  const id = newRequestId();
  requestIds[label] = id;
  return id;
}

async function createAndApprove(token: string, amount: string, label: string): Promise<Order> {
  const order = await ppFetch<Order>(token, "POST", "/v2/checkout/orders", {
    requestId: newRid(`${label}.create`),
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: `arbiter-spike-${label}`, amount: { currency_code: "USD", value: amount } }],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `http://localhost:${PORT}/return`,
            cancel_url: `http://localhost:${PORT}/cancel`,
          },
        },
      },
    },
  });
  console.log(`order ${order.body.id} status=${order.body.status}`);
  const link = order.body.links?.find((l) => l.rel === "payer-action") ?? order.body.links?.find((l) => l.rel === "approve");
  if (!link) throw new Error(`No payer-action/approve link on order ${order.body.id}`);
  console.log("\nOpen this URL in a PRIVATE window and approve as the CLIENT sandbox personal account:\n" + link.href + "\n");
  console.log("Waiting up to 5 minutes for the approval redirect on localhost...");
  try {
    await waitForApproval(PORT, 300_000);
  } catch (e) {
    console.error(`Approval not completed (${(e as Error).message}). Order id: ${order.body.id}. Nothing authorized or captured.`);
    process.exit(1);
  }
  return order.body;
}

async function authorize(token: string, orderId: string, label: string): Promise<Auth> {
  const res = await ppFetch<Order>(token, "POST", `/v2/checkout/orders/${orderId}/authorize`, {
    requestId: newRid(`${label}.authorize`),
    body: {},
  });
  const auth = res.body.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error(`Authorize response for ${orderId} has no authorization (order status ${res.body.status})`);
  return auth;
}

async function mainFlow(token: string, freelancerEmail: string): Promise<boolean> {
  const order = await createAndApprove(token, CAPTURE_AMOUNT, "main");
  const auth = await authorize(token, order.id, "main");
  const expMs = auth.expiration_time ? Date.parse(auth.expiration_time) : NaN;
  const expDays = Number.isNaN(expMs) ? undefined : Math.round(((expMs - Date.now()) / 86_400_000) * 100) / 100;
  console.log(`authorization ${auth.id} status=${auth.status} expiration_time=${auth.expiration_time ?? "(absent)"} (~${expDays ?? "?"} days from now)`);

  const captureRid = newRid("main.capture");
  const captureBody = { amount: { currency_code: "USD", value: CAPTURE_AMOUNT }, final_capture: true };
  const cap = await ppFetch<Capture>(token, "POST", `/v2/payments/authorizations/${auth.id}/capture`, {
    requestId: captureRid,
    body: captureBody,
    headers: { Prefer: "return=representation" },
  });
  const breakdown = cap.body.seller_receivable_breakdown;
  console.log(`capture ${cap.body.id} status=${cap.body.status}`);

  // Idempotency replay with the SAME PayPal-Request-Id.
  let replay: { sameCaptureId: boolean; status?: number; error?: string } = { sameCaptureId: false };
  try {
    const again = await ppFetch<Capture>(token, "POST", `/v2/payments/authorizations/${auth.id}/capture`, {
      requestId: captureRid,
      body: captureBody,
      headers: { Prefer: "return=representation" },
    });
    replay = { sameCaptureId: again.body.id === cap.body.id, status: again.status };
  } catch (e) {
    replay = { sameCaptureId: false, error: e instanceof PayPalError ? e.message : String(e) };
  }
  console.log(`replay with same request id: ${JSON.stringify(replay)}`);

  // Payout = capture minus the 5% Arbiter platform fee.
  const payoutCents = toCents(CAPTURE_AMOUNT) - Math.round((toCents(CAPTURE_AMOUNT) * PLATFORM_FEE_PCT) / 100);
  const payoutValue = fromCents(payoutCents);
  const batchId = `spike1-${Date.now()}`;
  const payout = await ppFetch<PayoutBatch>(token, "POST", "/v1/payments/payouts", {
    requestId: newRid("main.payout"),
    body: {
      sender_batch_header: { sender_batch_id: batchId, email_subject: "Arbiter spike payout", email_message: "Sandbox test payout from the Arbiter Phase 1 spike." },
      items: [{ recipient_type: "EMAIL", receiver: freelancerEmail, amount: { value: payoutValue, currency: "USD" }, note: "Arbiter spike", sender_item_id: `item-${Date.now()}` }],
    },
  });
  const payoutBatchId = payout.body.batch_header.payout_batch_id;
  console.log(`payout batch ${payoutBatchId} status=${payout.body.batch_header.batch_status}; polling up to 120s`);
  let polled: PayoutBatch | undefined;
  const terminalBatch = new Set(["SUCCESS", "DENIED", "CANCELED"]);
  for (let waited = 0; waited <= 120; waited += 5) {
    polled = (await ppFetch<PayoutBatch>(token, "GET", `/v1/payments/payouts/${payoutBatchId}`)).body;
    const st = polled.items?.[0]?.transaction_status;
    if (terminalBatch.has(polled.batch_header.batch_status) && st && st !== "PENDING" && st !== "PROCESSING") break;
    await sleep(5000);
  }
  const item = polled?.items?.[0];
  const itemStatus = item?.transaction_status ?? "(none)";

  // Fees: real capture fee and real payout fee.
  const gross = breakdown?.gross_amount?.value;
  const fee = breakdown?.paypal_fee?.value;
  const net = breakdown?.net_amount?.value;
  const payoutFee = item?.payout_item_fee?.value ?? polled?.batch_header.fees?.value;
  const feePct = gross && fee ? (toCents(fee) / toCents(gross)) * 100 : undefined;
  const coverage = net && payoutFee !== undefined ? fromCents(toCents(net) - payoutCents - toCents(payoutFee)) : undefined;

  const summary = {
    orderId: order.id,
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    authorizationExpirationTime: auth.expiration_time,
    authorizationDaysFromNow: expDays,
    captureId: cap.body.id,
    captureStatus: cap.body.status,
    captureFee: { gross, paypal_fee: fee, net, fee_percent: feePct?.toFixed(3) },
    replay,
    payout: { batchId: payoutBatchId, batchStatus: polled?.batch_header.batch_status, itemStatus, amount: payoutValue, payoutFee, batchFees: polled?.batch_header.fees?.value, itemErrors: item?.errors },
    feeCoverage: coverage,
  };
  run.summary = summary;
  console.log("\n===== SUMMARY =====");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nFEE LINE: capture fee ${fee ?? "?"} of ${gross ?? "?"} (${feePct?.toFixed(2) ?? "?"}%); payout fee ${payoutFee ?? "?"}`);
  console.log(`COVERAGE LINE: net ${net ?? "?"} - payout ${payoutValue} - payout fee ${payoutFee ?? "?"} = ${coverage ?? "?"} (negative = the 5% platform fee does not cover PayPal costs)`);

  const pass = auth.status === "CREATED" && cap.body.status === "COMPLETED" && replay.sameCaptureId && itemStatus === "SUCCESS";
  if (itemStatus !== "SUCCESS") console.error(`Payout item status is ${itemStatus}, not SUCCESS: not a pass.`);
  return pass;
}

async function probeFlow(token: string): Promise<boolean> {
  const order = await createAndApprove(token, "5.00", "probe");
  const auth = await authorize(token, order.id, "probe");
  console.log(`authorization ${auth.id} status=${auth.status} expiration_time=${auth.expiration_time ?? "(absent)"}`);
  let reauth: Record<string, unknown>;
  try {
    const r = await ppFetch<Record<string, unknown>>(token, "POST", `/v2/payments/authorizations/${auth.id}/reauthorize`, {
      requestId: newRid("probe.reauthorize"),
      body: { amount: { currency_code: "USD", value: "5.00" } },
    });
    reauth = { ok: true, status: r.status, body: r.body };
  } catch (e) {
    reauth = e instanceof PayPalError ? { ok: false, status: e.status, name: e.name_, message: e.message } : { ok: false, message: String(e) };
  }
  console.log("reauthorize:", JSON.stringify(reauth));
  const v = await ppFetch<unknown>(token, "POST", `/v2/payments/authorizations/${auth.id}/void`, { requestId: newRid("probe.void") });
  console.log(`void status=${v.status}`);
  run.summary = { orderId: order.id, authorizationId: auth.id, reauthorize: reauth, voidStatus: v.status };
  return v.status === 204;
}

async function main() {
  const env = requireEnvOrExit(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENVIRONMENT", ...(PROBE ? [] : ["PAYPAL_FREELANCER_EMAIL"])]);
  const token = await getAccessToken({
    PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID as string,
    PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET as string,
    PAYPAL_ENVIRONMENT: env.PAYPAL_ENVIRONMENT as string,
  });
  console.log("oauth token obtained (value not printed)");
  const ok = PROBE ? await probeFlow(token) : await mainFlow(token, env.PAYPAL_FREELANCER_EMAIL as string);
  run.result = ok ? "PASS" : "FAIL";
  mkdirSync(new URL("./.out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./.out/paypal-${PROBE ? "probe" : "run"}.json`, import.meta.url), JSON.stringify(run, null, 2));
  console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
