import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { createRunnerClient, MAX_ARTIFACT_BYTES, runnerConfigFrom } from "./runner-client";

const TOKEN = "github_pat_TEST_TOKEN_VALUE_123";
const cfg = { token: TOKEN, repo: "antonyjasfer/arbiter-runner" };
const RUN_NAME = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const SHA = "a".repeat(40);

type Call = { url: string; init: RequestInit };
function fakeFetch(...responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return typeof r === "function" ? r() : r.clone();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const headersOf = (c: Call) => new Headers(c.init.headers);

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const m of ["log", "error", "warn", "info", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("config", () => {
  it("returns runner_not_configured when the token or repo is missing", () => {
    expect(runnerConfigFrom({ GITHUB_RUNNER_TOKEN: undefined, RUNNER_REPO: "a/b" })).toEqual({ ok: false, error: "runner_not_configured" });
    expect(runnerConfigFrom({ GITHUB_RUNNER_TOKEN: TOKEN, RUNNER_REPO: undefined })).toEqual({ ok: false, error: "runner_not_configured" });
    expect(runnerConfigFrom({ GITHUB_RUNNER_TOKEN: TOKEN, RUNNER_REPO: "a/b" })).toEqual({ ok: true, value: { token: TOKEN, repo: "a/b" } });
  });
});

describe("dispatchVerify", () => {
  const input = { runName: RUN_NAME, repoUrl: "https://github.com/antonyjasfer/arbiter-demo-pass", sha: SHA, deployUrl: "https://demo.onrender.com", planB64: Buffer.from("{}").toString("base64") };

  it("posts the workflow dispatch with the inputs and GitHub headers", async () => {
    const f = fakeFetch(new Response(null, { status: 204 }));
    const r = await createRunnerClient(cfg, f.fn).dispatchVerify(input);
    expect(r.ok).toBe(true);
    const [c] = f.calls;
    expect(c!.url).toBe("https://api.github.com/repos/antonyjasfer/arbiter-runner/actions/workflows/verify.yml/dispatches");
    expect(c!.init.method).toBe("POST");
    expect(c!.init.redirect).toBe("manual");
    const h = headersOf(c!);
    expect(h.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(h.get("accept")).toBe("application/vnd.github+json");
    expect(h.get("x-github-api-version")).toBe("2022-11-28");
    expect(JSON.parse(String(c!.init.body))).toEqual({
      ref: "main",
      inputs: { repo_url: input.repoUrl, sha: SHA, deploy_url: input.deployUrl, run_name: RUN_NAME, plan_b64: input.planB64 },
    });
  });

  it("refuses hostile inputs locally without calling GitHub", async () => {
    const f = fakeFetch(new Response(null, { status: 204 }));
    const c = createRunnerClient(cfg, f.fn);
    for (const bad of [{ repoUrl: "https://github.com/a/b; curl evil" }, { sha: `${SHA}\n` }, { deployUrl: "javascript:alert(1)" }, { runName: "1;id" }, { planB64: "not base64!" }]) {
      expect(await c.dispatchVerify({ ...input, ...bad }), JSON.stringify(bad)).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(f.calls).toHaveLength(0);
  });

  it("maps 404, 403 and 422 to typed errors, and a 403 with no rate limit left to rate_limited", async () => {
    const c = (r: Response) => createRunnerClient(cfg, fakeFetch(r).fn).dispatchVerify(input);
    expect(await c(json({ message: "Not Found" }, 404))).toEqual({ ok: false, error: "not_found" });
    expect(await c(json({ message: "Forbidden" }, 403))).toEqual({ ok: false, error: "forbidden" });
    expect(await c(json({ message: "Unexpected inputs provided" }, 422))).toEqual({ ok: false, error: "unprocessable" });
    expect(await c(json({ message: "rate" }, 403, { "x-ratelimit-remaining": "0" }))).toEqual({ ok: false, error: "rate_limited" });
    expect(await c(json({ message: "boom" }, 502))).toEqual({ ok: false, error: "github_error" });
  });

  it("never logs the token, even when fetch throws an error that contains it", async () => {
    const f = { fn: (async () => { throw new Error(`connect failed for Bearer ${TOKEN}`); }) as unknown as typeof fetch };
    const r = await createRunnerClient(cfg, f.fn).dispatchVerify(input);
    expect(r).toEqual({ ok: false, error: "github_error" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
  });
});

describe("runs, jobs and artifacts", () => {
  it("finds a run by its run-name created after the dispatch", async () => {
    const since = new Date("2026-11-05T10:00:00Z");
    const f = fakeFetch(
      json({
        total_count: 3,
        workflow_runs: [
          { id: 1, display_title: RUN_NAME, created_at: "2026-11-05T09:00:00Z", html_url: "https://github.com/x/1", status: "completed", conclusion: "success" },
          { id: 2, display_title: "other", created_at: "2026-11-05T10:00:05Z", html_url: "https://github.com/x/2", status: "queued", conclusion: null },
          { id: 3, display_title: RUN_NAME, created_at: "2026-11-05T10:00:03Z", html_url: "https://github.com/x/3", status: "in_progress", conclusion: null },
        ],
      }),
    );
    const r = await createRunnerClient(cfg, f.fn).findRunByName(RUN_NAME, since);
    expect(r).toEqual({ ok: true, value: { id: 3, htmlUrl: "https://github.com/x/3", status: "in_progress", conclusion: null } });
    expect(f.calls[0]!.url).toContain("/actions/workflows/verify.yml/runs?event=workflow_dispatch");
  });

  it("reads one run's status by id", async () => {
    const f = fakeFetch(json({ id: 42, display_title: RUN_NAME, created_at: "2026-11-05T10:00:03Z", html_url: "https://github.com/x/42", status: "completed", conclusion: "failure" }));
    expect(await createRunnerClient(cfg, f.fn).getRun(42)).toEqual({ ok: true, value: { id: 42, htmlUrl: "https://github.com/x/42", status: "completed", conclusion: "failure" } });
    expect(f.calls[0]!.url).toBe("https://api.github.com/repos/antonyjasfer/arbiter-runner/actions/runs/42");
  });

  it("returns null when no run carries the name yet", async () => {
    const r = await createRunnerClient(cfg, fakeFetch(json({ total_count: 0, workflow_runs: [] })).fn).findRunByName(RUN_NAME, new Date());
    expect(r).toEqual({ ok: true, value: null });
  });

  it("reads each job's conclusion, steps and times", async () => {
    const f = fakeFetch(
      json({
        total_count: 1,
        jobs: [{ id: 9, name: "tests", status: "completed", conclusion: "failure", started_at: "2026-11-05T10:01:00Z", completed_at: "2026-11-05T10:02:00Z", steps: [{ name: "npm test", number: 4, status: "completed", conclusion: "failure" }] }],
      }),
    );
    const r = await createRunnerClient(cfg, f.fn).getJobs(42);
    expect(r).toEqual({
      ok: true,
      value: [{ id: 9, name: "tests", status: "completed", conclusion: "failure", startedAt: "2026-11-05T10:01:00Z", completedAt: "2026-11-05T10:02:00Z", steps: [{ name: "npm test", number: 4, status: "completed", conclusion: "failure" }] }],
    });
    expect(f.calls[0]!.url).toBe("https://api.github.com/repos/antonyjasfer/arbiter-runner/actions/runs/42/jobs?per_page=50");
  });

  it("rejects a malformed GitHub response as bad_response", async () => {
    expect(await createRunnerClient(cfg, fakeFetch(json({ jobs: "nope" })).fn).getJobs(42)).toEqual({ ok: false, error: "bad_response" });
  });

  it("lists artifacts with id, name, created_at and size", async () => {
    const f = fakeFetch(json({ total_count: 1, artifacts: [{ id: 5, name: "arbiter-results", created_at: "2026-11-05T10:01:30Z", size_in_bytes: 1234, expired: false, workflow_run: { id: 42 } }] }));
    expect(await createRunnerClient(cfg, f.fn).listArtifacts(42)).toEqual({ ok: true, value: [{ id: 5, name: "arbiter-results", createdAt: "2026-11-05T10:01:30Z", sizeInBytes: 1234, expired: false }] });
  });
});

describe("downloadArtifact", () => {
  const meta = (size: number, runId = 42) => json({ id: 5, name: "arbiter-results", size_in_bytes: size, expired: false, created_at: "2026-11-05T10:01:30Z", workflow_run: { id: runId } });
  const redirect = () => new Response(null, { status: 302, headers: { location: "https://blob.example/zip?sig=1" } });

  it("follows the redirect without sending the token, and unzips the files", async () => {
    const zip = zipSync({ "results.json": new TextEncoder().encode('{"ok":true}') });
    const f = fakeFetch(meta(zip.length), redirect(), new Response(zip, { status: 200 }));
    const r = await createRunnerClient(cfg, f.fn).downloadArtifact(42, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new TextDecoder().decode(r.value["results.json"])).toBe('{"ok":true}');
    expect(f.calls[1]!.url).toBe("https://api.github.com/repos/antonyjasfer/arbiter-runner/actions/artifacts/5/zip");
    expect(f.calls[2]!.url).toBe("https://blob.example/zip?sig=1");
    expect(headersOf(f.calls[2]!).get("authorization")).toBeNull();
  });

  it("refuses an artifact over 8 MB before downloading it", async () => {
    const f = fakeFetch(meta(MAX_ARTIFACT_BYTES + 1));
    expect(MAX_ARTIFACT_BYTES).toBe(8 * 1024 * 1024);
    expect(await createRunnerClient(cfg, f.fn).downloadArtifact(42, 5)).toEqual({ ok: false, error: "too_large" });
    expect(f.calls).toHaveLength(1);
  });

  it("refuses a zip whose files inflate past 8 MB (a zip bomb) without inflating them", async () => {
    const zip = zipSync({ "big.bin": new Uint8Array(MAX_ARTIFACT_BYTES + 10) }, { level: 9 });
    expect(zip.length).toBeLessThan(100_000);
    const f = fakeFetch(meta(zip.length), redirect(), new Response(zip, { status: 200 }));
    expect(await createRunnerClient(cfg, f.fn).downloadArtifact(42, 5)).toEqual({ ok: false, error: "too_large" });
  });

  it("refuses an artifact that belongs to another run", async () => {
    const f = fakeFetch(meta(100, 7));
    expect(await createRunnerClient(cfg, f.fn).downloadArtifact(42, 5)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("repository reads", () => {
  it("checks the repo is public", async () => {
    const c = (r: Response) => createRunnerClient(cfg, fakeFetch(r).fn).isPublicRepo("a", "b");
    expect(await c(json({ private: false, visibility: "public" }))).toEqual({ ok: true, value: true });
    expect(await c(json({ private: true, visibility: "private" }))).toEqual({ ok: true, value: false });
    expect(await c(json({ message: "Not Found" }, 404))).toEqual({ ok: true, value: false });
  });

  it("lists the tree at the commit and reads files raw at that commit", async () => {
    const f = fakeFetch(
      json({ sha: SHA, truncated: false, tree: [{ path: "README.md", type: "blob", size: 5 }, { path: "src", type: "tree" }] }),
      new Response("hello", { status: 200 }),
    );
    const c = createRunnerClient(cfg, f.fn);
    expect(await c.getRepoTree("a", "b", SHA)).toEqual({ ok: true, value: [{ path: "README.md", size: 5 }] });
    expect(await c.getRepoFiles("a", "b", SHA, ["README.md"])).toEqual({ ok: true, value: [{ path: "README.md", content: "hello" }] });
    expect(f.calls[0]!.url).toBe(`https://api.github.com/repos/a/b/git/trees/${SHA}?recursive=1`);
    expect(f.calls[1]!.url).toBe(`https://api.github.com/repos/a/b/contents/README.md?ref=${SHA}`);
    expect(headersOf(f.calls[1]!).get("accept")).toBe("application/vnd.github.raw+json");
  });

  it("refuses path traversal and odd owner names without calling GitHub", async () => {
    const f = fakeFetch(json({}));
    const c = createRunnerClient(cfg, f.fn);
    expect(await c.getRepoFiles("a", "b", SHA, ["../x"])).toEqual({ ok: false, error: "invalid_input" });
    expect(await c.isPublicRepo("a/../../x", "b")).toEqual({ ok: false, error: "invalid_input" });
    expect(f.calls).toHaveLength(0);
  });
});
