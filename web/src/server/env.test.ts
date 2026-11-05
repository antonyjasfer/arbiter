import { describe, expect, it } from "vitest";
import { EnvError, parseServerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://u:p@ep-x-pooler.c-1.us-east-1.aws.neon.tech/db?sslmode=require",
  AUTH_SECRET: "auth-secret-value-1",
  AUTH_GITHUB_ID: "gh-id-value-2",
  AUTH_GITHUB_SECRET: "gh-secret-value-3",
  PAYPAL_CLIENT_ID: "pp-id-value-4",
  PAYPAL_CLIENT_SECRET: "pp-secret-value-5",
  PAYPAL_ENVIRONMENT: "SANDBOX",
  GEMINI_API_KEY: "gemini-key-value-6",
};

describe("phase 4 and 5 variables", () => {
  it("leaves the runner and payout settings optional, so the app still boots without them", () => {
    const env = parseServerEnv(valid);
    expect(env.GITHUB_RUNNER_TOKEN).toBeUndefined();
    expect(env.RUNNER_REPO).toBeUndefined();
    expect(env.PAYPAL_FREELANCER_EMAIL).toBeUndefined();
  });

  it("checks the runner repo and payout email formats when they are set", () => {
    expect(parseServerEnv({ ...valid, RUNNER_REPO: "antonyjasfer/arbiter-runner", PAYPAL_FREELANCER_EMAIL: "f@example.test" })).toMatchObject({ RUNNER_REPO: "antonyjasfer/arbiter-runner" });
    expect(() => parseServerEnv({ ...valid, RUNNER_REPO: "not a repo" })).toThrow(/RUNNER_REPO/);
    expect(() => parseServerEnv({ ...valid, PAYPAL_FREELANCER_EMAIL: "nope" })).toThrow(/PAYPAL_FREELANCER_EMAIL/);
  });
});

describe("phase 3 variables", () => {
  it("requires GEMINI_API_KEY", () => {
    const rest: Record<string, string | undefined> = { ...valid };
    delete rest.GEMINI_API_KEY;
    expect(() => parseServerEnv(rest)).toThrow(/GEMINI_API_KEY/);
  });

  it("defaults GEMINI_MODEL to gemini-3.6-flash", () => {
    expect(parseServerEnv(valid).GEMINI_MODEL).toBe("gemini-3.6-flash");
    expect(parseServerEnv({ ...valid, GEMINI_MODEL: "gemini-3.8-flash" }).GEMINI_MODEL).toBe("gemini-3.8-flash");
  });

  it("turns DEMO_MODE on only for the exact string true", () => {
    expect(parseServerEnv({ ...valid, DEMO_MODE: "true" }).DEMO_MODE).toBe(true);
    for (const v of ["TRUE", "1", "yes", "", undefined]) expect(parseServerEnv({ ...valid, DEMO_MODE: v }).DEMO_MODE).toBe(false);
  });
});

describe("parseServerEnv", () => {
  it("parses a complete environment and leaves PAYPAL_WEBHOOK_ID optional", () => {
    const env = parseServerEnv(valid);
    expect(env.PAYPAL_ENVIRONMENT).toBe("SANDBOX");
    expect(env.PAYPAL_WEBHOOK_ID).toBeUndefined();
    expect(parseServerEnv({ ...valid, PAYPAL_WEBHOOK_ID: "WH-1" }).PAYPAL_WEBHOOK_ID).toBe("WH-1");
  });

  it("treats a blank PAYPAL_WEBHOOK_ID as absent", () => {
    expect(parseServerEnv({ ...valid, PAYPAL_WEBHOOK_ID: "  " }).PAYPAL_WEBHOOK_ID).toBeUndefined();
  });

  it("refuses anything but the sandbox", () => {
    expect(() => parseServerEnv({ ...valid, PAYPAL_ENVIRONMENT: "LIVE" })).toThrow(/PAYPAL_ENVIRONMENT/);
  });

  it("lists missing and blank names only, never values", () => {
    const rest: Record<string, string | undefined> = { ...valid, DATABASE_URL: "   " };
    delete rest.AUTH_SECRET;
    let caught: unknown;
    try {
      parseServerEnv(rest);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvError);
    const err = caught as EnvError;
    expect(err.names).toEqual(["AUTH_SECRET", "DATABASE_URL"]);
    for (const v of Object.values(valid)) expect(err.message).not.toContain(v);
  });
});
