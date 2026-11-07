import { after } from "next/server";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getRunnerClient } from "@/server/verification/runner-client";
import { getRunStatus, resumeDueRuns } from "@/server/verification/runs";

// GET /api/verification-runs/:runId — polled by the milestone panel. Each poll also advances due runs (after
// the response, at most one GitHub step per run per 15 s), so a run left behind by a restart or a Render cold
// start continues without in-process timers. Members only; anything else is 404.
export async function GET(_request: Request, ctx: RouteContext<"/api/verification-runs/[runId]">): Promise<Response> {
  const user = await requireUser();
  if (!user.ok) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { runId } = await ctx.params;
  const r = await getRunStatus(getDb(), { userId: user.value.userId, runId });
  const runner = getRunnerClient();
  if (runner.ok) after(() => resumeDueRuns(getDb(), runner.value).catch((e: unknown) => console.error("verification resume failed:", e instanceof Error ? e.name : "error")));
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}
