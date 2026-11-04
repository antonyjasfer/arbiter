"use server";

// Server actions for projects and agreements. Each one validates its input with Zod, checks the
// session, and calls a tested server function; none holds logic of its own. Errors come back as codes.
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dollarsToCents } from "@/lib/format";
import { parseId } from "@/lib/ids";
import { getAi } from "@/server/ai/default-ai";
import { agreementBodySchema } from "@/server/agreements/body";
import type { CheckProblem } from "@/server/agreements/compiler";
import { resumeDueJobs, retryJobNow, runJob, startCompile } from "@/server/agreements/compile-jobs";
import { approve, createManualVersion, saveEdit } from "@/server/agreements/versions";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import { acceptInvite, createInvite } from "@/server/projects/invitations";
import { createProject } from "@/server/projects/projects";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string; problems?: CheckProblem[] };

function kickOff(jobId: string) {
  // Runs after the response is sent; if the process dies first, a status poll or the next boot resumes it.
  after(() => runJob(getDb(), getAi(), jobId).catch((e: unknown) => console.error("compile job failed to run:", e instanceof Error ? e.name : "error")));
}

const newProjectSchema = z.object({ title: z.string(), brief: z.string(), budget: z.string() });

export async function createProjectAction(_prev: ActionResult<never> | null, form: FormData): Promise<ActionResult<never>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const input = newProjectSchema.safeParse({ title: form.get("title"), brief: form.get("brief"), budget: form.get("budget") });
  const budgetCents = input.success ? dollarsToCents(input.data.budget) : null;
  if (!input.success || budgetCents === null) return { ok: false, error: "invalid_input" };
  const db = getDb();
  const p = await createProject(db, { userId: user.value.userId, title: input.data.title, brief: input.data.brief, budgetCents });
  if (!p.ok) return { ok: false, error: p.error };
  const job = await startCompile(db, { userId: user.value.userId, projectId: p.value.projectId, model: serverEnv().GEMINI_MODEL });
  if (job.ok) kickOff(job.value.jobId);
  // A capped compile still creates the project; the workspace shows why the AI draft didn't start.
  redirect(`/projects/${p.value.projectId}${job.ok ? "" : `?compile=${job.error}`}`);
}

const answersSchema = z.array(z.object({ question: z.string().max(300), answer: z.string().trim().max(1000) })).max(5);

export async function startCompileAction(projectId: string, answers: { question: string; answer: string }[]): Promise<ActionResult<{ jobId: string }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const parsed = answersSchema.safeParse(answers);
  if (!parseId(projectId) || !parsed.success) return { ok: false, error: "not_found" };
  const r = await startCompile(getDb(), { userId: user.value.userId, projectId, answers: parsed.data.filter((a) => a.answer), model: serverEnv().GEMINI_MODEL });
  if (!r.ok) return { ok: false, error: r.error };
  kickOff(r.value.jobId);
  return { ok: true, value: r.value };
}

export async function saveEditAction(projectId: string, expectedHash: string, body: unknown): Promise<ActionResult<{ version: number }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(projectId)) return { ok: false, error: "not_found" };
  const parsed = agreementBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_body", problems: [{ code: "invalid_shape" }] };
  const r = await saveEdit(getDb(), { userId: user.value.userId, projectId, expectedHash: String(expectedHash), body: parsed.data });
  if (!r.ok) return { ok: false, error: r.error.code, problems: r.error.code === "invalid_body" ? r.error.problems : undefined };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, value: { version: r.value.version } };
}

export async function createManualVersionAction(projectId: string, body: unknown): Promise<ActionResult<{ version: number }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(projectId)) return { ok: false, error: "not_found" };
  const parsed = agreementBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "invalid_body", problems: [{ code: "invalid_shape" }] };
  const r = await createManualVersion(getDb(), { userId: user.value.userId, projectId, body: parsed.data });
  if (!r.ok) return { ok: false, error: r.error.code, problems: r.error.code === "invalid_body" ? r.error.problems : undefined };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, value: { version: r.value.version } };
}

export async function approveAction(projectId: string, expectedHash: string): Promise<ActionResult<{ locked: boolean }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(projectId)) return { ok: false, error: "not_found" };
  const r = await approve(getDb(), { userId: user.value.userId, projectId, expectedHash: String(expectedHash) });
  if (!r.ok) return { ok: false, error: r.error.code };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, value: r.value };
}

export async function retryNowAction(jobId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const r = await retryJobNow(getDb(), { userId: user.value.userId, jobId: String(jobId) });
  if (!r.ok) return { ok: false, error: r.error };
  after(() => resumeDueJobs(getDb(), getAi()).catch((e: unknown) => console.error("compile job retry failed:", e instanceof Error ? e.name : "error")));
  return { ok: true, value: undefined };
}

export async function createInviteAction(projectId: string): Promise<ActionResult<{ path: string; expiresAt: string }>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  if (!parseId(projectId)) return { ok: false, error: "not_found" };
  const r = await createInvite(getDb(), { userId: user.value.userId, projectId });
  if (!r.ok) return { ok: false, error: r.error };
  // The token is shown once, in the client's browser only; the database keeps its hash.
  return { ok: true, value: { path: `/invite/${r.value.token}`, expiresAt: r.value.expiresAt.toISOString() } };
}

export async function acceptInviteAction(token: string): Promise<ActionResult<never>> {
  const user = await requireUser();
  if (!user.ok) return { ok: false, error: "unauthenticated" };
  const r = await acceptInvite(getDb(), { userId: user.value.userId, token: String(token) });
  if (!r.ok) return { ok: false, error: r.error };
  redirect(`/projects/${r.value.projectId}`);
}
