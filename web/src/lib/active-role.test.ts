import { describe, expect, it } from "vitest";
import { ACTIVE_ROLE_COOKIE, parseActiveRole } from "./active-role";

describe("parseActiveRole", () => {
  it("defaults to client when the cookie is missing", () => {
    expect(parseActiveRole(undefined)).toBe("client");
  });
  it("accepts freelancer and client exactly", () => {
    expect(parseActiveRole("freelancer")).toBe("freelancer");
    expect(parseActiveRole("client")).toBe("client");
  });
  it("falls back to client for anything else", () => {
    expect(parseActiveRole("admin")).toBe("client");
    expect(parseActiveRole("FREELANCER")).toBe("client");
  });
  it("uses the arbiter_role cookie name", () => {
    expect(ACTIVE_ROLE_COOKIE).toBe("arbiter_role");
  });
});
