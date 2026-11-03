import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

// GET /api/health: no database access (keep-warm pings must not wake Neon). ?db=1 also runs SELECT 1.
export async function GET(request: Request): Promise<Response> {
  await connection();
  const body: { ok: boolean; uptimeSeconds: number; db?: "ok" | "error" } = { ok: true, uptimeSeconds: Math.round(process.uptime()) };
  if (new URL(request.url).searchParams.get("db") === "1") {
    try {
      await getDb().execute(sql`select 1`);
      body.db = "ok";
    } catch {
      body.db = "error";
      body.ok = false;
    }
  }
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
