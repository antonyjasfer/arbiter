"use server";

// Server actions for payments. Each validates its input, checks the session and calls a tested function
// in server/payments; none holds logic of its own and none is reachable from AI code. Errors are codes.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { parseId } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { checkSameOrigin } from "@/server/http/same-origin";
import { getPaypalApi } from "@/server/payments/default-api";
import { livePayment, loadMilestone } from "@/server/payments/context";
import { cancelFunding, completeFunding, startFunding } from "@/server/payments/funding";
import { setPaypalEmail } from "@/server/payments/payee";
import { approveRelease, sendPayout } from "@/server/payments/release";
import { guardVerdicts } from "@/server/payments/verdicts";
import type { ActionResult } from "./actions";

const orderIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
// The guard enforces the 20-character minimum; this only bounds the size and drops an empty reason.
const overrideSchema = z
  .string()
  .max(2000)
  .transform((s) => s.trim() || undefined)
  .optional();

export async function startFundingAction(projectId: string, milestoneId: string): Promise<ActionResult<{ orderId: string }>> {
  if (!checkSameOrigin(await headers())) return { ok: false, error: "forbidden_origin" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(String(projectId)) || !parseId(String(milestoneId))) return { ok: false, error: "not_found" };
  const r = await startFunding(getDb(), getPaypalApi(), { userId: user.value.userId, milestoneId });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { orderId: r.value.orderId } };
}

export async function completeFundingAction(projectId: string, milestoneId: string, orderId: string): Promise<ActionResult<{ state: string }>> {
  if (!checkSameOrigin(await headers())) return { ok: false, error: "forbidden_origin" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const order = orderIdSchema.safeParse(orderId);
  if (!parseId(String(projectId)) || !parseId(String(milestoneId)) || !order.success) return { ok: false, error: "not_found" };
  const r = await completeFunding(getDb(), getPaypalApi(), { userId: user.value.userId, milestoneId, orderId: order.data });
  revalidatePath(`/projects/${projectId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { state: r.value.state } };
}

/** The client cancels a funded milestone before any work is submitted: voids the PayPal hold. */
export async function cancelFundingAction(projectId: string, milestoneId: string): Promise<ActionResult<{ state: string }>> {
  if (!checkSameOrigin(await headers())) return { ok: false, error: "forbidden_origin" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(String(projectId)) || !parseId(String(milestoneId))) return { ok: false, error: "not_found" };
  const r = await cancelFunding(getDb(), getPaypalApi(), { userId: user.value.userId, milestoneId });
  revalidatePath(`/projects/${projectId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { state: r.value.state } };
}

/**
 * The client approves the release: guard, capture, and (if the capture completed) the payout. A PENDING
 * capture or a payout that didn't start is finished by the poll route (reconcilePayment).
 */
export async function approveReleaseAction(projectId: string, milestoneId: string, overrideReason: string | null): Promise<ActionResult<{ state: string }>> {
  if (!checkSameOrigin(await headers())) return { ok: false, error: "forbidden_origin" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(String(projectId)) || !parseId(String(milestoneId))) return { ok: false, error: "not_found" };
  const reason = overrideSchema.safeParse(overrideReason ?? undefined);
  if (!reason.success) return { ok: false, error: "override_too_short" };
  const db = getDb();
  const api = getPaypalApi();
  const r = await approveRelease(db, api, { userId: user.value.userId, milestoneId, overrideReason: reason.data, latestVerdicts: guardVerdicts(db) });
  if (r.ok && r.value.state === "RELEASED") {
    const p = await livePayment(db, milestoneId);
    if (p) await sendPayout(db, api, p.id);
  }
  revalidatePath(`/projects/${projectId}`);
  if (!r.ok) return { ok: false, error: r.error };
  const m = await loadMilestone(db, milestoneId);
  return { ok: true, value: { state: m?.state ?? r.value.state } };
}

export async function setPaypalEmailAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!checkSameOrigin(await headers())) return { ok: false, error: "forbidden_origin" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const email = form.get("paypalEmail");
  const r = await setPaypalEmail(getDb(), { userId: user.value.userId, email: typeof email === "string" ? email : "" });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/settings");
  return { ok: true, value: undefined };
}
