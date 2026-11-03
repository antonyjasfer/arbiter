// Server-only environment, validated once. Errors name variables, never values.
import { z } from "zod";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const required = z.preprocess(blankToUndefined, z.string());

const schema = z.object({
  DATABASE_URL: required,
  AUTH_SECRET: required,
  AUTH_GITHUB_ID: required,
  AUTH_GITHUB_SECRET: required,
  PAYPAL_CLIENT_ID: required,
  PAYPAL_CLIENT_SECRET: required,
  // Sandbox only (CLAUDE.md rule 8).
  PAYPAL_ENVIRONMENT: z.preprocess(blankToUndefined, z.literal("SANDBOX")),
  // Optional: the webhook route answers 503 until it is set.
  PAYPAL_WEBHOOK_ID: z.preprocess(blankToUndefined, z.string().optional()),
  GEMINI_API_KEY: required,
  // FINDINGS: gemini-3.8-flash was overloaded on the free tier; 3.6 works.
  GEMINI_MODEL: z.preprocess(blankToUndefined, z.string().default("gemini-3.6-flash")),
  // Demo sign-in exists only when this is exactly "true".
  DEMO_MODE: z.preprocess((v) => v === "true", z.boolean()),
});

export type ServerEnv = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`Invalid or missing environment variables: ${names.join(", ")}`);
    this.name = "EnvError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].sort();
  throw new EnvError(names);
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
