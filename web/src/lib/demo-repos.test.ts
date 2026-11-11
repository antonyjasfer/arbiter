import { describe, expect, it } from "vitest";
import { checkDeployUrl, checkRepoUrl, checkSha } from "@/server/verification/submissions";
import { DEMO_REPOS, demoRepoOptions } from "./demo-repos";

describe("DEMO_REPOS (one-click submissions for demo projects)", () => {
  it("has the three pinned demo repos", () => {
    expect(DEMO_REPOS.map((d) => d.id)).toEqual(["pass", "fail", "injection"]);
  });

  it.each(DEMO_REPOS.map((d) => [d.id, d] as const))("%s passes the same validators as any submission", (_id, d) => {
    expect(d.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(checkSha(d.commitSha)).toBe(d.commitSha);
    expect(checkRepoUrl(d.repoUrl)?.url).toBe(d.repoUrl);
    expect(d.repoUrl).toBe(`https://github.com/antonyjasfer/arbiter-demo-${d.id}`);
    expect(checkDeployUrl(d.deployUrl)).not.toBeNull(); // https, public host (not private, loopback or link-local)
    expect(d.label.length).toBeGreaterThan(0);
    expect(d.expect.length).toBeGreaterThan(0);
  });

  it("is offered only on demo projects", () => {
    expect(demoRepoOptions(false)).toEqual([]);
    expect(demoRepoOptions(true)).toBe(DEMO_REPOS);
  });
});
