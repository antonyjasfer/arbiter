// The three checks every money-moving or work-starting POST route makes, in this order, before any work:
// 1. same origin (else 403), 2. signed in (else 401), 3. member (the work itself returns not_found → 404).
import type { Result } from "@/lib/result";

export async function guardedPost<T>(d: {
  sameOrigin: boolean;
  userId: () => Promise<string | null>;
  run: (userId: string) => Promise<Result<T, "not_found">>;
}): Promise<Response> {
  if (!d.sameOrigin) return Response.json({ error: "forbidden_origin" }, { status: 403 });
  const userId = await d.userId();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const r = await d.run(userId);
  if (!r.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(r.value, { headers: { "Cache-Control": "no-store" } });
}
