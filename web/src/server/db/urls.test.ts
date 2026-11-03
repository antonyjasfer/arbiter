import { describe, expect, it } from "vitest";
import { appDatabaseUrl, directDatabaseUrl } from "./urls";

const RAW = "postgres://u:p@ep-x-pooler.c-1.us-east-1.aws.neon.tech/db?sslmode=require&channel_binding=require";

describe("database urls", () => {
  it("app url keeps the pooled host and sets sslmode=verify-full", () => {
    const u = new URL(appDatabaseUrl(RAW));
    expect(u.hostname).toBe("ep-x-pooler.c-1.us-east-1.aws.neon.tech");
    expect(u.searchParams.get("sslmode")).toBe("verify-full");
    expect(u.searchParams.get("channel_binding")).toBe("require");
  });

  it("direct url drops -pooler from the endpoint id only", () => {
    const u = new URL(directDatabaseUrl(RAW));
    expect(u.hostname).toBe("ep-x.c-1.us-east-1.aws.neon.tech");
    expect(u.searchParams.get("sslmode")).toBe("verify-full");
    expect(u.username).toBe("u");
    expect(u.pathname).toBe("/db");
  });

  it("adds sslmode when the url has none", () => {
    expect(new URL(appDatabaseUrl("postgres://u:p@ep-y-pooler.aws.neon.tech/db")).searchParams.get("sslmode")).toBe("verify-full");
  });
});
