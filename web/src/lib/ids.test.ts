import { describe, expect, it } from "vitest";
import { parseId } from "./ids";

describe("parseId", () => {
  it("returns a valid UUID unchanged", () => {
    const id = "0b9f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(parseId(id)).toBe(id);
  });

  it("rejects anything that is not exactly a UUID", () => {
    for (const bad of ["1 or 1=1", "", "0b9f6a1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b ", "../etc/passwd", "0b9f6a1e3c2d4e5f8a9b0c1d2e3f4a5b"]) {
      expect(parseId(bad)).toBeNull();
    }
  });
});
