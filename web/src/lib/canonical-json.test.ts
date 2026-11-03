import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("gives the same text for the same value built in a different key order", () => {
    expect(canonicalJson({ x: { q: true, p: null } })).toBe(canonicalJson({ x: { p: null, q: true } }));
  });

  it("keeps non-ASCII text exactly", () => {
    const s = "café ₹50 — ✓";
    expect(JSON.parse(canonicalJson({ s })).s).toBe(s);
  });

  it("refuses values that have no single canonical form", () => {
    for (const bad of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, undefined, new Date(0), () => 1, { a: undefined }]) {
      expect(() => canonicalJson(bad)).toThrow();
    }
  });
});

describe("sha256Hex", () => {
  it("hashes UTF-8 text to lowercase hex", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
