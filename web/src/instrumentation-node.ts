// 1. Local runs: load the single repo-root .env.local (Next only reads env files from web/).
//    On Render there is no such file, so nothing is reloaded and the dashboard's env vars stay as they are.
// 2. Fail fast: on missing env vars, log their names (never values) and exit.
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { serverEnv } from "@/server/env";
import { checkEnvOrExit, loadRootEnvIfPresent } from "@/server/startup";

loadRootEnvIfPresent(path.resolve(process.cwd(), ".."), {
  exists: existsSync,
  // forceReload: Next has already loaded (and cached) env files from web/, which has none.
  load: (dir) => loadEnvConfig(dir, process.env.NODE_ENV !== "production", { info: () => {}, error: console.error }, true),
});
if (process.env.NEXT_PHASE !== "phase-production-build") {
  checkEnvOrExit(serverEnv, { exit: (code) => process.exit(code), error: (message) => console.error(message) });
  // 3. Resume compile jobs left unfinished by a restart or cold start (status polls also resume them).
  void Promise.all([import("@/server/agreements/compile-jobs"), import("@/server/ai/default-ai"), import("@/server/db/client")])
    .then(([jobs, ai, db]) => jobs.resumeDueJobs(db.getDb(), ai.getAi()))
    .catch((e: unknown) => console.error("compile-jobs resume on boot failed:", e instanceof Error ? e.name : "error"));
}
