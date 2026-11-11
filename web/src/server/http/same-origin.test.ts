import { describe, expect, it } from "vitest";
import { checkSameOrigin, expectedOrigin, isAllowedOrigin } from "./same-origin";

const LIVE = "https://arbiter-q41f.onrender.com";
const h = (o: Record<string, string>) => new Headers(o);

describe("isAllowedOrigin", () => {
  it("matches the exact origin, with or without a trailing slash", () => {
    expect(isAllowedOrigin(LIVE, LIVE)).toBe(true);
    expect(isAllowedOrigin(`${LIVE}/`, LIVE)).toBe(true);
  });
  it("refuses another port, another scheme, another host, null and garbage", () => {
    expect(isAllowedOrigin("https://arbiter-q41f.onrender.com:8443", LIVE)).toBe(false);
    expect(isAllowedOrigin("http://arbiter-q41f.onrender.com", LIVE)).toBe(false);
    expect(isAllowedOrigin("https://evil.example", LIVE)).toBe(false);
    expect(isAllowedOrigin("https://arbiter-q41f.onrender.com.evil.example", LIVE)).toBe(false);
    expect(isAllowedOrigin(null, LIVE)).toBe(false);
    expect(isAllowedOrigin("null", LIVE)).toBe(false);
    expect(isAllowedOrigin("not a url", LIVE)).toBe(false);
  });
});

describe("expectedOrigin", () => {
  it("uses AUTH_URL's origin and ignores the Host header (Render's Host is localhost:10000)", () => {
    expect(expectedOrigin(h({ host: "localhost:10000" }), { authUrl: `${LIVE}/some/path`, nodeEnv: "production" })).toBe(LIVE);
  });
  it("falls back to the dev server's own Host only outside production", () => {
    expect(expectedOrigin(h({ host: "localhost:3000" }), { nodeEnv: "development" })).toBe("http://localhost:3000");
    expect(expectedOrigin(h({ host: "localhost:3000" }), { nodeEnv: "production" })).toBeNull();
  });
});

describe("checkSameOrigin", () => {
  it("accepts a same-origin POST and refuses a cross-site or Origin-less one", () => {
    const env = { authUrl: LIVE, nodeEnv: "production" };
    expect(checkSameOrigin(h({ origin: LIVE, host: "localhost:10000" }), env)).toBe(true);
    expect(checkSameOrigin(h({ origin: "https://evil.example", host: "localhost:10000" }), env)).toBe(false);
    expect(checkSameOrigin(h({ host: "localhost:10000" }), env)).toBe(false);
  });
  it("AUTH_URL unset in production refuses everything (fail closed)", () => {
    expect(checkSameOrigin(h({ origin: "http://localhost:10000", host: "localhost:10000" }), { nodeEnv: "production" })).toBe(false);
  });
});
