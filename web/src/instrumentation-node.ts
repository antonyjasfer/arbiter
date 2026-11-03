// 1. Local runs: load the single repo-root .env.local (Next only reads env files from web/).
//    On Render there is no such file; the dashboard's env vars are already in process.env.
// 2. Fail fast, naming any missing env vars (never values).
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { serverEnv } from "@/server/env";

// forceReload: Next has already loaded (and cached) env files from web/, which has none.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error }, true);
if (process.env.NEXT_PHASE !== "phase-production-build") serverEnv();
