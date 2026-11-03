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
};

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
