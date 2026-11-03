import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";
import { directDatabaseUrl } from "./src/server/db/urls";

loadEnvConfig(path.resolve(process.cwd(), ".."));

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // Migrations use the direct (unpooled) host; the app uses the pooled one.
  dbCredentials: { url: directDatabaseUrl(process.env.DATABASE_URL ?? "postgres://placeholder@localhost/none") },
  strict: true,
});
