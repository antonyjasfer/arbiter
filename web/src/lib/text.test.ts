import { describe, expect, it } from "vitest";
import { hasControlChars } from "./text";

describe("hasControlChars", () => {
  it("finds NUL, other C0 controls and DEL in any text", () => {
    for (const s of ["a\u0000b", "bell\u0007", "esc\u001b[31m", "del\u007f", "vt\u000b"]) {
      expect(hasControlChars(s, "multiline")).toBe(true);
      expect(hasControlChars(s, "line")).toBe(true);
    }
  });

  it("allows tab and newlines only in multi-line text", () => {
    expect(hasControlChars("line one\nline two\r\n\tindented", "multiline")).toBe(false);
    expect(hasControlChars("title\nsecond line", "line")).toBe(true);
    expect(hasControlChars("title\twith tab", "line")).toBe(true);
  });

  it("leaves ordinary text, including non-Latin scripts and emoji, alone", () => {
    for (const s of ["TaskBoard", "café ₹500 — ✓ 🍰", "मेनू पेज"]) expect(hasControlChars(s, "line")).toBe(false);
  });
});
