import { describe, expect, it } from "vitest";
import { EnvError } from "./env";
import { checkEnvOrExit, loadRootEnvIfPresent } from "./startup";

describe("loadRootEnvIfPresent (review finding: never reload env on Render)", () => {
  it("loads only when <root>/.env.local exists", () => {
    const loaded: string[] = [];
    expect(loadRootEnvIfPresent("/repo", { exists: () => false, load: (d) => loaded.push(d) })).toBe(false);
    expect(loaded).toEqual([]);
    expect(loadRootEnvIfPresent("/repo", { exists: (p) => p.split("\\").join("/") === "/repo/.env.local", load: (d) => loaded.push(d) })).toBe(true);
    expect(loaded).toHaveLength(1);
  });
});

describe("checkEnvOrExit (Review Focus 5: boot fails)", () => {
  it("exits with code 1 and logs the names only", () => {
    const logs: string[] = [];
    let code: number | undefined;
    checkEnvOrExit(
      () => {
        throw new EnvError(["AUTH_SECRET"]);
      },
      { exit: (c) => void (code = c), error: (m) => logs.push(m) },
    );
    expect(code).toBe(1);
    expect(logs.join(" ")).toContain("AUTH_SECRET");
  });
  it("does nothing when the env is valid", () => {
    let code: number | undefined;
    checkEnvOrExit(() => ({}), { exit: (c) => void (code = c), error: () => {} });
    expect(code).toBeUndefined();
  });
  it("rethrows errors that are not env errors", () => {
    expect(() =>
      checkEnvOrExit(
        () => {
          throw new Error("boom");
        },
        { exit: () => {}, error: () => {} },
      ),
    ).toThrow("boom");
  });
});
