import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, newRequestId } from "./paypal.js";

afterEach(() => vi.unstubAllGlobals());

describe("newRequestId", () => {
  it("is a UUID v4 and differs between calls", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("getAccessToken", () => {
  it("refuses to run unless PAYPAL_ENVIRONMENT is SANDBOX, without any network call", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be called");
    });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      getAccessToken({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s", PAYPAL_ENVIRONMENT: "LIVE" }),
    ).rejects.toThrow(/SANDBOX/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
