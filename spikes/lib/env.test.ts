import { describe, expect, it } from "vitest";
import { MissingEnvError, requireEnv, setEnvValue } from "./env.js";

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

describe("setEnvValue", () => {
  it("replaces a blank value and leaves other lines alone", () => {
    expect(setEnvValue("A=1\nPAYPAL_WEBHOOK_ID=\n# note\nB=2\n", "PAYPAL_WEBHOOK_ID", "WH-1")).toBe("A=1\nPAYPAL_WEBHOOK_ID=WH-1\n# note\nB=2\n");
  });
  it("replaces an existing value and keeps CRLF line endings", () => {
    expect(setEnvValue("A=1\r\nPAYPAL_WEBHOOK_ID=old\r\nB=2\r\n", "PAYPAL_WEBHOOK_ID", "WH-1")).toBe("A=1\r\nPAYPAL_WEBHOOK_ID=WH-1\r\nB=2\r\n");
  });
  it("does not touch a name that only shares a prefix", () => {
    expect(setEnvValue("PAYPAL_WEBHOOK_ID_OLD=x\n", "PAYPAL_WEBHOOK_ID", "WH-1")).toBe("PAYPAL_WEBHOOK_ID_OLD=x\nPAYPAL_WEBHOOK_ID=WH-1\n");
  });
  it("appends when the name is missing, on a new line", () => {
    expect(setEnvValue("A=1", "PAYPAL_WEBHOOK_ID", "WH-1")).toBe("A=1\nPAYPAL_WEBHOOK_ID=WH-1\n");
  });
  it("does not expand $ patterns in the value", () => {
    expect(setEnvValue("X=old\n", "X", "a$&b")).toBe("X=a$&b\n");
  });
});
