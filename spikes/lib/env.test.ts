import { describe, expect, it } from "vitest";
import { MissingEnvError, requireEnv } from "./env.js";

describe("requireEnv", () => {
  it("returns the requested values", () => {
    expect(requireEnv(["A"], { A: "x" })).toEqual({ A: "x" });
  });

  it("lists missing names only, never values", () => {
    try {
      requireEnv(["A", "B"], { A: "secret-value-x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingEnvError);
      const msg = (e as Error).message;
      expect(msg).toContain("B");
      expect(msg).not.toContain("secret-value-x");
    }
  });

  it("treats a blank string as missing", () => {
    expect(() => requireEnv(["A"], { A: "   " })).toThrow(/A/);
    expect(() => requireEnv(["A"], { A: "" })).toThrow(/A/);
  });
});
