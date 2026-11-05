"use server";

// Server actions for payments. Each validates its input, checks the session and calls a tested function
// in server/payments; none holds logic of its own and none is reachable from AI code. Errors are codes.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseId } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getPaypalApi } from "@/server/payments/default-api";
import { completeFunding, startFunding } from "@/server/payments/funding";
import { setPaypalEmail } from "@/server/payments/payee";
import type { ActionResult } from "./actions";

const orderIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

export async function startFundingAction(projectId: string, milestoneId: string): Promise<ActionResult<{ orderId: string }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(String(projectId)) || !parseId(String(milestoneId))) return { ok: false, error: "not_found" };
  const r = await startFunding(getDb(), getPaypalApi(), { userId: user.value.userId, milestoneId });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { orderId: r.value.orderId } };
}

export async function completeFundingAction(projectId: string, milestoneId: string, orderId: string): Promise<ActionResult<{ state: string }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const order = orderIdSchema.safeParse(orderId);
  if (!parseId(String(projectId)) || !parseId(String(milestoneId)) || !order.success) return { ok: false, error: "not_found" };
  const r = await completeFunding(getDb(), getPaypalApi(), { userId: user.value.userId, milestoneId, orderId: order.data });
  revalidatePath(`/projects/${projectId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { state: r.value.state } };
}

export async function setPaypalEmailAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const email = form.get("paypalEmail");
  const r = await setPaypalEmail(getDb(), { userId: user.value.userId, email: typeof email === "string" ? email : "" });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/settings");
  return { ok: true, value: undefined };
}
