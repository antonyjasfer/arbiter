import { describe, expect, it } from "vitest";
import { dollarsToCents, formatCents, formatIst, pollDelay, projectBadge } from "./format";

describe("formatCents", () => {
  it("formats integer cents as US dollars", () => {
    expect(formatCents(12345)).toBe("$123.45");
    expect(formatCents(5000)).toBe("$50.00");
    expect(formatCents(500000)).toBe("$5,000.00");
  });
});

describe("dollarsToCents", () => {
  it("parses a typed dollar amount exactly", () => {
    expect(dollarsToCents("300")).toBe(30000);
    expect(dollarsToCents(" 123.45 ")).toBe(12345);
    expect(dollarsToCents("1,250.5")).toBe(125050);
    expect(dollarsToCents("$50")).toBe(5000);
  });

  it("rejects anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.3.4"]) expect(dollarsToCents(bad)).toBeNull();
  });
});

describe("projectBadge", () => {
  it("describes where the agreement stands for the viewer", () => {
    expect(projectBadge({ hasVersion: false, locked: false, role: "client", mine: false, theirs: false })).toEqual({ label: "Draft", tone: "pending" });
    expect(projectBadge({ hasVersion: true, locked: false, role: "client", mine: false, theirs: false })).toEqual({ label: "Waiting for you", tone: "review" });
    expect(projectBadge({ hasVersion: true, locked: false, role: "client", mine: true, theirs: false })).toEqual({ label: "Waiting for freelancer", tone: "pending" });
    expect(projectBadge({ hasVersion: true, locked: false, role: "freelancer", mine: true, theirs: false })).toEqual({ label: "Waiting for client", tone: "pending" });
    expect(projectBadge({ hasVersion: true, locked: true, role: "freelancer", mine: true, theirs: true })).toEqual({ label: "Locked", tone: "pass" });
  });
});

describe("pollDelay", () => {
  it("starts at 2 s and backs off to 5 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(pollDelay)).toEqual([2000, 3000, 4000, 5000, 5000, 5000]);
  });
});

describe("formatIst", () => {
  it("shows a time in India Standard Time", () => {
    expect(formatIst(new Date("2026-11-04T00:00:00Z"))).toMatch(/4 Nov 2026.*5:30\s?am/i);
  });
});
