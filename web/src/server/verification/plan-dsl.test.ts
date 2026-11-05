import { describe, expect, it } from "vitest";
import { checkPlanSchema, criterionPlanSchema, MAX_STEPS, planHash, type CheckPlan } from "./plan-dsl";

const ok = (v: unknown) => criterionPlanSchema.safeParse(v).success;

describe("check DSL: allowed operations", () => {
  it("accepts each browser operation with its exact fields", () => {
    expect(
      ok({
        kind: "browser",
        steps: [
          { op: "goto", path: "/" },
          { op: "fill_by_label", label: "New task", value: "Buy milk" },
          { op: "click_by_role", role: "button", name: "Add" },
          { op: "expect_text", text: "Buy milk" },
          { op: "click_by_role", role: "checkbox", name: "Buy milk" },
          { op: "expect_checkbox_checked", label: "Buy milk" },
          { op: "http_get", path: "/health", status: 200 },
          { op: "http_get", path: "/api/health", status: 200, json: { status: "ok", up: true, n: 1, extra: null } },
        ],
      }),
    ).toBe(true);
  });

  it("accepts the static operations, the test operation and an empty review plan", () => {
    expect(
      ok({
        kind: "static",
        steps: [
          { op: "file_exists", path: "README.md" },
          { op: "file_contains", path: "docs/setup.md", text: "npm start" },
          { op: "package_script_exists", script: "test" },
        ],
      }),
    ).toBe(true);
    expect(ok({ kind: "test", steps: [{ op: "npm_test" }] })).toBe(true);
    expect(ok({ kind: "review", steps: [] })).toBe(true);
  });
});

describe("check DSL: rejections", () => {
  it("rejects unknown operations, eval-like operations, CSS or XPath selector fields and extra fields", () => {
    expect(ok({ kind: "browser", steps: [{ op: "evaluate", script: "1" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "eval", code: "alert(1)" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "click", selector: "#add" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "click_by_role", role: "button", name: "Add", selector: "//button" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "click_by_role", role: "iframe", name: "x" }] })).toBe(false);
  });

  it("rejects javascript: URLs and every absolute or protocol-relative URL; paths only", () => {
    for (const path of ["javascript:alert(1)", "https://evil.example/", "http://169.254.169.254/latest", "//evil.example/x", "/\\evil.example", "relative", "/a b", "/\nx"]) {
      expect(ok({ kind: "browser", steps: [{ op: "goto", path }] }), path).toBe(false);
      expect(ok({ kind: "browser", steps: [{ op: "http_get", path, status: 200 }] }), path).toBe(false);
    }
  });

  it("rejects more than 15 steps", () => {
    const steps = Array.from({ length: MAX_STEPS + 1 }, () => ({ op: "expect_text", text: "x" }));
    expect(MAX_STEPS).toBe(15);
    expect(ok({ kind: "browser", steps })).toBe(false);
    expect(ok({ kind: "browser", steps: steps.slice(0, 15) })).toBe(true);
  });

  it("rejects selectors over 200 characters, empty selectors and control characters", () => {
    expect(ok({ kind: "browser", steps: [{ op: "expect_text", text: "x".repeat(201) }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "expect_text", text: "x".repeat(200) }] })).toBe(true);
    expect(ok({ kind: "browser", steps: [{ op: "fill_by_label", label: "", value: "a" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "expect_text", text: "a\u0000b" }] })).toBe(false);
  });

  it("gives review criteria no steps, and mixes no kinds", () => {
    expect(ok({ kind: "review", steps: [{ op: "expect_text", text: "x" }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "file_exists", path: "README.md" }] })).toBe(false);
    expect(ok({ kind: "static", steps: [{ op: "goto", path: "/" }] })).toBe(false);
    expect(ok({ kind: "test", steps: [{ op: "npm_test" }, { op: "npm_test" }] })).toBe(false);
  });

  it("rejects repo paths that climb out or are absolute, and floats in JSON expectations", () => {
    for (const path of ["../secret", "a/../../b", "/etc/passwd", "C:\\x", ""]) {
      expect(ok({ kind: "static", steps: [{ op: "file_exists", path }] }), path).toBe(false);
    }
    expect(ok({ kind: "browser", steps: [{ op: "http_get", path: "/h", status: 200, json: { v: 1.5 } }] })).toBe(false);
    expect(ok({ kind: "browser", steps: [{ op: "http_get", path: "/h", status: 200, json: { v: { nested: 1 } } }] })).toBe(false);
  });
});

describe("check plan and hash", () => {
  const plan: CheckPlan = {
    m1c1: { kind: "browser", steps: [{ op: "goto", path: "/" }] },
    m1c2: { kind: "review", steps: [] },
  };

  it("is keyed by stable criterion keys", () => {
    expect(checkPlanSchema.safeParse(plan).success).toBe(true);
    expect(checkPlanSchema.safeParse({ crit1: { kind: "review", steps: [] } }).success).toBe(false);
  });

  it("hashes to the same 64-hex value regardless of key order, and differently when a step changes", () => {
    const reordered: CheckPlan = { m1c2: plan.m1c2!, m1c1: plan.m1c1! };
    expect(planHash(plan)).toMatch(/^[0-9a-f]{64}$/);
    expect(planHash(reordered)).toBe(planHash(plan));
    expect(planHash({ ...plan, m1c1: { kind: "browser", steps: [{ op: "goto", path: "/x" }] } })).not.toBe(planHash(plan));
  });
});
