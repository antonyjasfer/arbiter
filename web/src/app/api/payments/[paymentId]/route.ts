import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { guardedPost } from "@/server/http/guarded-post";
import { checkSameOrigin } from "@/server/http/same-origin";
import { getPaymentView } from "@/server/payments/payment-view";
import { getPaypalApi } from "@/server/payments/default-api";
import { reconcilePayment } from "@/server/payments/reconcile";

async function sessionUserId(): Promise<string | null> {
  const user = await requireUser();
  return user.ok ? user.value.userId : null;
}

// GET /api/payments/:paymentId — the stored payment state. Read-only: no PayPal call and no write, so a
// crawler, prefetch or <img src> can never move money. Members only; anything else is 404.
export async function GET(_request: Request, ctx: RouteContext<"/api/payments/[paymentId]">): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { paymentId } = await ctx.params;
  const r = await getPaymentView(getDb(), { userId, paymentId });
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/payments/:paymentId — the page asks the server to reconcile with PayPal's read-back (at most one
// PayPal round per payment every 30 s), so a capture that settles while no webhook can arrive (a cold start,
// a deploy) still moves to RELEASED and the payout follows. Same-origin, signed-in members only.
export async function POST(request: Request, ctx: RouteContext<"/api/payments/[paymentId]">): Promise<Response> {
  const { paymentId } = await ctx.params;
  return guardedPost({
    sameOrigin: checkSameOrigin(request.headers),
    userId: sessionUserId,
    run: (userId) => reconcilePayment(getDb(), getPaypalApi(), { userId, paymentId }),
  });
}
