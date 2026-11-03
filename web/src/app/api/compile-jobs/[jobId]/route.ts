import { after } from "next/server";
import { getAi } from "@/server/ai/default-ai";
import { getJobStatus, resumeDueJobs } from "@/server/agreements/compile-jobs";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

// GET /api/compile-jobs/:jobId — polled by the workspace. Each poll also resumes any due job (after the
// response), so a job left behind by a restart or cold start continues without in-process timers.
export async function GET(_request: Request, ctx: RouteContext<"/api/compile-jobs/[jobId]">): Promise<Response> {
  const user = await requireUser();
  if (!user.ok) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { jobId } = await ctx.params;
  const r = await getJobStatus(getDb(), { userId: user.value.userId, jobId });
  after(() => resumeDueJobs(getDb(), getAi()).catch((e: unknown) => console.error("compile-jobs resume failed:", e instanceof Error ? e.name : "error")));
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}
