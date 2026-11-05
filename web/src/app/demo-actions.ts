"use server";

// Demo sign-in and Reset. Both exist only when DEMO_MODE is "true"; the demo provider itself is not
// registered otherwise, so signIn("demo") would fail anyway.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { signIn } from "@/auth";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { resetDemo, type DemoCache } from "@/server/demo/seed";
import { serverEnv } from "@/server/env";
import cache from "@/server/demo/compiled-cache.json";

export async function demoSignInAction(role: "client" | "freelancer"): Promise<void> {
  if (!serverEnv().DEMO_MODE) redirect("/");
  await signIn("demo", { role: role === "freelancer" ? "freelancer" : "client", redirectTo: "/dashboard" });
}

export async function resetDemoAction(): Promise<{ ok: boolean; error?: string }> {
  if (!serverEnv().DEMO_MODE) return { ok: false, error: "not_demo" };
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const r = await resetDemo(getDb(), { userId: user.value.userId, model: serverEnv().GEMINI_MODEL, cache: cache as DemoCache, freelancerPaypalEmail: serverEnv().PAYPAL_FREELANCER_EMAIL });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/dashboard");
  return { ok: true };
}
