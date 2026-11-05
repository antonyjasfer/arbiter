"use server";

// Server actions for verification (Phase 4). Each validates its input shape with Zod, checks the session
// and calls a tested server function; none holds logic of its own. Errors come back as codes.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseId } from "@/lib/ids";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { submitWork } from "@/server/verification/submissions";

export type VerificationActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

const submitSchema = z.object({ repoUrl: z.string().max(300), commitSha: z.string().max(64), deployUrl: z.string().max(500) });

export async function submitWorkAction(projectId: string, milestoneId: string, input: unknown): Promise<VerificationActionResult<{ submissionId: string }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const parsed = submitSchema.safeParse(input);
  if (!parseId(projectId) || !parseId(milestoneId) || !parsed.success) return { ok: false, error: "not_found" };
  const r = await submitWork(getDb(), { userId: user.value.userId, milestoneId, ...parsed.data });
  if (!r.ok) return r;
  revalidatePath(`/projects/${projectId}`);
  return r;
}
