import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getPaypalApi } from "@/server/payments/default-api";
import { reconcilePayment } from "@/server/payments/reconcile";

// GET /api/payments/:paymentId — polled by the project page. Members only. Each poll reconciles the
// payment from PayPal's read-back (at most every 30 s), so a capture that settles while no webhook can
// arrive (localhost, a cold start, a deploy) still moves to RELEASED and the payout follows.
export async function GET(_request: Request, ctx: RouteContext<"/api/payments/[paymentId]">): Promise<Response> {
  const user = await requireUser();
  if (!user.ok) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { paymentId } = await ctx.params;
  const r = await reconcilePayment(getDb(), getPaypalApi(), { userId: user.value.userId, paymentId });
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}
