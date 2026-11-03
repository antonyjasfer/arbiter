import { describe, expect, it } from "vitest";
import { feeFor } from "./fees";

describe("feeFor (5% + $1.00, half up)", () => {
  it("matches the worked examples", () => {
    expect(feeFor(5000)).toEqual({ feeCents: 350, payoutCents: 4650 });
    expect(feeFor(15000)).toEqual({ feeCents: 850, payoutCents: 14150 });
    expect(feeFor(12345)).toEqual({ feeCents: 717, payoutCents: 11628 });
  });

  it("rounds half a cent up", () => {
    expect(feeFor(5010)).toEqual({ feeCents: 351, payoutCents: 4659 }); // 250.5 -> 251
  });

  it("refuses non-integer or negative amounts", () => {
    for (const bad of [-1, 10.5, Number.NaN]) expect(() => feeFor(bad)).toThrow();
  });
});
