import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getEvidence } from "@/server/verification/evidence";

// GET /api/evidence/:evidenceId — a stored screenshot or results.json, for members of the run's project only.
// The bytes are re-hashed against the stored SHA-256 before serving. Only image/jpeg and application/json are
// ever served, with nosniff and a sandboxing CSP, so stored evidence cannot run as a page on Arbiter's origin.
export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[evidenceId]">): Promise<Response> {
  const user = await requireUser();
  if (!user.ok) return new Response("Not found", { status: 404 });
  const { evidenceId } = await ctx.params;
  const r = await getEvidence(getDb(), { userId: user.value.userId, evidenceId });
  if (!r.ok) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(r.value.content), {
    headers: {
      "Content-Type": r.value.contentType,
      "Content-Length": String(r.value.content.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
