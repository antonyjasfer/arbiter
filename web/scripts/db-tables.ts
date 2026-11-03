// Read-only check: list public tables and applied migrations. Prints names only.
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import pg from "pg";
import { appDatabaseUrl } from "../src/server/db/urls";

loadEnvConfig(path.resolve(process.cwd(), ".."));
async function main() {
  const client = new pg.Client({ connectionString: appDatabaseUrl(process.env.DATABASE_URL ?? "") });
  await client.connect();
  const t = await client.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
  const m = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  console.log(`public tables (${t.rowCount}): ${t.rows.map((r) => r.table_name).join(", ")}`);
  console.log(`applied migrations: ${m.rows[0].n}`);
  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
