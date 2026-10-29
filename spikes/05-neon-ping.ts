// SPIKE 5 (throwaway): prove DATABASE_URL (Neon free) works. Two SELECT 1 round trips: first may hit a suspended compute.
// Never prints the connection string.
import pg from "pg";
import { requireEnvOrExit } from "./lib/env.js";

async function timedQuery(url: string, label: string): Promise<{ ms: number; version: string }> {
  const t0 = Date.now();
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 60_000 });
  await client.connect();
  try {
    await client.query("SELECT 1");
    const v = await client.query("SHOW server_version");
    const ms = Date.now() - t0;
    console.log(`${label}: connect + SELECT 1 + SHOW server_version in ${ms}ms`);
    return { ms, version: String((v.rows[0] as { server_version?: string } | undefined)?.server_version ?? "?") };
  } finally {
    await client.end();
  }
}

async function main() {
  const env = requireEnvOrExit(["DATABASE_URL"]);
  const url = env.DATABASE_URL as string;
  const host = (() => {
    try {
      const h = new URL(url).hostname;
      return h.replace(/^[^.]+/, "<endpoint>");
    } catch {
      return "(unparseable url)";
    }
  })();
  console.log(`host pattern: ${host}`);
  const first = await timedQuery(url, "first (may be cold)");
  const second = await timedQuery(url, "second (warm)");
  console.log(`server_version: ${second.version}; cold/first ${first.ms}ms, warm/second ${second.ms}ms`);
  console.log("\nRESULT: PASS");
}

main().catch((e) => {
  console.error(`RESULT: FAIL (${e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/gi, "<url>") : "error"})`);
  process.exit(1);
});
