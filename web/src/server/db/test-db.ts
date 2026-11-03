// Tests only: an in-process Postgres (PGlite) with the real generated migrations applied.
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

// One migrated PGlite per test file (creating one takes 5-20 s here), emptied before each test.
export function setupTestDb(): () => TestDb {
  let t: Awaited<ReturnType<typeof createTestDb>> | undefined;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    const rows = await t!.db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
    const names = rows.rows.map((r) => `"${r.tablename}"`).join(", ");
    await t!.db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
  });
  return () => t!.db;
}
