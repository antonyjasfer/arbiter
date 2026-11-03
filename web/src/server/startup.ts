// Server start-up helpers (called from instrumentation-node.ts), kept separate so they can be tested.
import path from "node:path";
import { EnvError } from "./env";

/** Loads <root>/.env.local only if it exists, so Render (no such file) never reloads its environment. */
export function loadRootEnvIfPresent(rootDir: string, deps: { exists: (file: string) => boolean; load: (dir: string) => void }): boolean {
  if (!deps.exists(path.join(rootDir, ".env.local"))) return false;
  deps.load(rootDir);
  return true;
}

/** Validates the env; on an EnvError logs the names (never values) and exits, so a bad deploy never starts. */
export function checkEnvOrExit(check: () => unknown, deps: { exit: (code: number) => void; error: (message: string) => void }): void {
  try {
    check();
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    deps.error(e.message);
    deps.exit(1);
  }
}
