// Phase 2 driver evaluation: pg Pool vs @neondatabase/serverless (HTTP and WebSocket Pool).
// Prints milliseconds only, never the connection string. Run: npx tsx scripts/db-bench.ts
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { neon, Pool as NeonPool } from "@neondatabase/serverless";
import pg from "pg";
import { appDatabaseUrl } from "../src/server/db/urls";

loadEnvConfig(path.resolve(process.cwd(), ".."));
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is not set");
const url = appDatabaseUrl(raw);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
async function time(fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await fn();
  return Math.round(performance.now() - t);
}

type PoolLike = { query: (q: string) => Promise<unknown>; connect: () => Promise<{ query: (q: string) => Promise<unknown>; release: () => void }>; end: () => Promise<void> };

async function benchPool(name: string, pool: PoolLike) {
  const first = await time(() => pool.query("SELECT 1"));
  const warm: number[] = [];
  for (let i = 0; i < 10; i++) warm.push(await time(() => pool.query("SELECT 1")));
  const tx = await time(async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT 1");
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  });
  await pool.end();
  console.log(`${name.padEnd(28)} first=${first}ms warm-median=${median(warm)}ms interactive-tx=${tx}ms`);
}

async function main() {
  await benchPool("pg Pool (TCP)", new pg.Pool({ connectionString: url, max: 1 }) as unknown as PoolLike);
  await benchPool("neon Pool (WebSocket)", new NeonPool({ connectionString: url, max: 1 }) as unknown as PoolLike);

  const sql = neon(url);
  const first = await time(() => sql`SELECT 1`);
  const warm: number[] = [];
  for (let i = 0; i < 10; i++) warm.push(await time(() => sql`SELECT 1`));
  const batch = await time(() => sql.transaction([sql`SELECT 1`, sql`SELECT 1`]));
  console.log(`${"neon() HTTP".padEnd(28)} first=${first}ms warm-median=${median(warm)}ms batch-tx=${batch}ms (no interactive tx)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>") : String(e));
  process.exit(1);
});
