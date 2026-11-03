import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "../env";
import { appDatabaseUrl } from "./urls";
import * as schema from "./schema";

let instance: NodePgDatabase<typeof schema> | undefined;

// Created on first use, so routes that never query (such as /api/health) do not wake Neon.
export function getDb(): NodePgDatabase<typeof schema> {
  instance ??= drizzle(new Pool({ connectionString: appDatabaseUrl(serverEnv().DATABASE_URL), max: 5 }), { schema });
  return instance;
}
