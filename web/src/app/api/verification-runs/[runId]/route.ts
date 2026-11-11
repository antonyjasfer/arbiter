import { after } from "next/server";
import { getAi } from "@/server/ai/default-ai";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { guardedPost } from "@/server/http/guarded-post";
import { checkSameOrigin } from "@/server/http/same-origin";
import { getRunnerClient } from "@/server/verification/runner-client";
import { getRunStatus, runStep } from "@/server/verification/runs";

async function sessionUserId(): Promise<string | null> {
  const user = await requireUser();
  return user.ok ? user.value.userId : null;
}

// GET /api/verification-runs/:runId — the run's stored status. Read-only. Members only; anything else is 404.
export async function GET(_request: Request, ctx: RouteContext<"/api/verification-runs/[runId]">): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { runId } = await ctx.params;
  const r = await getRunStatus(getDb(), { userId, runId });
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/verification-runs/:runId — the milestone panel asks the server to advance this run by one step
// (after the response; nothing happens unless the run is due, and its 240 s lease stops double work), so a run
// left behind by a restart or a Render cold start continues without in-process timers. Same-origin members only.
export async function POST(request: Request, ctx: RouteContext<"/api/verification-runs/[runId]">): Promise<Response> {
  const { runId } = await ctx.params;
  return guardedPost({
    sameOrigin: checkSameOrigin(request.headers),
    userId: sessionUserId,
    run: async (userId) => {
      const r = await getRunStatus(getDb(), { userId, runId });
      const runner = getRunnerClient();
      if (r.ok && runner.ok) {
        after(() => runStep(getDb(), runner.value, runId, undefined, getAi()).catch((e: unknown) => console.error("verification step failed:", e instanceof Error ? e.name : "error")));
      }
      return r;
    },
  });
}
