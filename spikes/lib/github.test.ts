import { describe, expect, it } from "vitest";
import { matchRunByTitle, parseRepoUrl, validateVerifyInputs } from "./github.js";

describe("parseRepoUrl", () => {
  it("parses github.com urls with or without .git", () => {
    expect(parseRepoUrl("https://github.com/a/b")).toEqual({ owner: "a", repo: "b" });
    expect(parseRepoUrl("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
  });

  it("rejects other hosts and shell metacharacters", () => {
    expect(() => parseRepoUrl("https://evil.com/a/b")).toThrow();
    expect(() => parseRepoUrl("https://github.com/a/b; rm -rf /")).toThrow();
    expect(() => parseRepoUrl("http://github.com/a/b")).toThrow();
    expect(() => parseRepoUrl("https://github.com/a/b/c")).toThrow();
  });
});

describe("matchRunByTitle", () => {
  const notBefore = new Date("2026-10-29T10:00:00Z");
  const runs = [
    { id: 1, display_title: "verify 111", created_at: "2026-10-29T09:00:00Z" },
    { id: 2, display_title: "verify 111", created_at: "2026-10-29T10:00:05Z" },
    { id: 3, display_title: "verify 222", created_at: "2026-10-29T10:00:06Z" },
    { id: 4, display_title: "verify 111", created_at: "2026-10-29T10:00:09Z" },
  ];

  it("ignores runs older than notBefore and other run ids, and returns the newest match", () => {
    expect(matchRunByTitle(runs, "111", notBefore)).toBe(4);
    expect(matchRunByTitle(runs, "222", notBefore)).toBe(3);
  });

  it("returns undefined when nothing matches", () => {
    expect(matchRunByTitle(runs, "999", notBefore)).toBeUndefined();
    expect(matchRunByTitle([runs[0]!], "111", notBefore)).toBeUndefined();
  });
});

describe("validateVerifyInputs", () => {
  const good = {
    repoUrl: "https://github.com/a/b",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    runId: "1730000000000",
    deployUrl: "https://example.com/path?q=1",
  };

  it("accepts a valid set", () => {
    expect(validateVerifyInputs(good)).toEqual([]);
  });

  const bad: [string, Partial<typeof good>][] = [
    ["repo url with shell metacharacters", { repoUrl: "https://github.com/a/b;touch x" }],
    ["repo url on another host", { repoUrl: "https://gitlab.com/a/b" }],
    ["short sha", { commitSha: "abc123" }],
    ["uppercase sha", { commitSha: "0123456789ABCDEF0123456789abcdef01234567" }],
    ["41-char sha", { commitSha: "0123456789abcdef0123456789abcdef012345678" }],
    ["sha with a command", { commitSha: "HEAD;id" }],
    ["http deploy url", { deployUrl: "http://example.com" }],
    ["deploy url with a space", { deployUrl: "https://example.com/a b" }],
    ["deploy url with a control character", { deployUrl: "https://example.com/a\u001b[0m" }],
    ["non-numeric run id", { runId: "12ab" }],
    ["run id with a command", { runId: "1; echo" }],
    ["run id longer than 18 digits", { runId: "1234567890123456789" }],
  ];
  for (const [name, patch] of bad) {
    it(`reports a problem for: ${name}`, () => {
      expect(validateVerifyInputs({ ...good, ...patch }).length).toBeGreaterThan(0);
    });
  }
});
