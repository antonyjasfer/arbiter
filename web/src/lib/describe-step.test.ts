import { describe, expect, it } from "vitest";
import { describeStep } from "./describe-step";

describe("describeStep", () => {
  it("says exactly which JSON fields an http_get checked, and when the body was not checked (review I-3, 8 Nov)", () => {
    expect(describeStep({ op: "http_get", path: "/health", status: 200, json: { ok: true, n: 3, s: "x", z: null } })).toBe('GET /health returns 200 with JSON ok = true, n = 3, s = "x", z = null');
    expect(describeStep({ op: "http_get", path: "/health", status: 200 })).toBe("GET /health returns 200 (body not checked)");
  });
  it("describes browser and static steps in plain words", () => {
    expect(describeStep({ op: "fill_by_label", label: "Task", value: "Buy milk" })).toBe("type “Buy milk” into “Task”");
    expect(describeStep({ op: "expect_checkbox_checked", label: "Buy milk" })).toBe("see “Buy milk” checked");
    expect(describeStep({ op: "npm_test" })).toBe("npm test exits with code 0");
    expect(describeStep(undefined)).toBe("");
  });
});
