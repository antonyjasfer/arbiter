import { describe, expect, it } from "vitest";
import { isMalformedRoute, requiresSignIn } from "./route-ids";

const uuid = "0b9f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
const token = "A".repeat(43);

describe("isMalformedRoute", () => {
  it("flags project pages whose id is not a UUID", () => {
    for (const p of ["/projects/not-a-uuid", "/projects/1%20or%201%3D1/audit", `/projects/${uuid}x`, "/projects/../etc"]) expect(isMalformedRoute(p)).toBe(true);
  });

  it("flags invite links whose token is not 43 base64url characters", () => {
    for (const p of ["/invite/short", `/invite/${token}A`, "/invite/%27%3B%20drop"]) expect(isMalformedRoute(p)).toBe(true);
  });

  it("leaves well-formed and unrelated paths alone", () => {
    for (const p of [`/projects/${uuid}`, `/projects/${uuid}/audit`, "/projects/new", `/invite/${token}`, "/dashboard", "/", "/settings"]) {
      expect(isMalformedRoute(p)).toBe(false);
    }
  });
});

describe("requiresSignIn", () => {
  it("protects the dashboard, projects and settings, but not invite links", () => {
    expect(requiresSignIn("/dashboard")).toBe(true);
    expect(requiresSignIn(`/projects/${uuid}`)).toBe(true);
    expect(requiresSignIn("/settings")).toBe(true);
    expect(requiresSignIn(`/invite/${token}`)).toBe(false);
  });
});
