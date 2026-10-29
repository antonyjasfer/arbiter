// Spike helper (throwaway). Loads <repo-root>/.env.local and reports missing variable NAMES only.
import { readFileSync } from "node:fs";

export class MissingEnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`Missing or blank environment variables: ${names.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[m[1] as string] = value;
  }
  return out;
}

function loadDefaultSource(): Record<string, string | undefined> {
  let fileVars: Record<string, string> = {};
  try {
    fileVars = parseEnvFile(readFileSync(new URL("../../.env.local", import.meta.url), "utf8"));
  } catch {
    // no file: fall through to process.env only
  }
  return { ...process.env, ...fileVars }; // .env.local wins over stale shell variables
}

export function requireEnv(
  names: string[],
  source: Record<string, string | undefined> = loadDefaultSource(),
): Record<string, string> {
  const missing = names.filter((n) => !(source[n] ?? "").trim());
  if (missing.length) throw new MissingEnvError(missing);
  return Object.fromEntries(names.map((n) => [n, source[n] as string]));
}

/** Exit code 2 with names only, as the plan's Review Focus item 1 requires. */
export function requireEnvOrExit(names: string[]): Record<string, string> {
  try {
    return requireEnv(names);
  } catch (e) {
    if (e instanceof MissingEnvError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}
