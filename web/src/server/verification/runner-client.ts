// GitHub REST client for arbiter-runner and for reading submitted repos. Uses GITHUB_RUNNER_TOKEN and
// RUNNER_REPO (serverEnv); the token is sent only to api.github.com and is never logged or returned.
// Every response is validated with Zod. Sources (GitHub REST docs, version 2022-11-28):
// "Create a workflow dispatch event" (204, no run id: FINDINGS s2), "List workflow runs for a workflow",
// "List jobs for a workflow run attempt", "List workflow run artifacts", "Download an artifact" (302 to a
// signed URL on another host: the token must not follow it), "Get a tree", "Get repository content" (raw).
import { unzipSync } from "fflate";
import { z } from "zod";
import type { Result } from "@/lib/result";
import { serverEnv } from "../env";
import { DEPLOY_URL_RE, REPO_URL_RE, SHA_RE } from "./submissions";

export const API = "https://api.github.com";
export const WORKFLOW_FILE = "verify.yml";
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_ARTIFACT_FILES = 64;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_PLAN_B64 = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const NAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const REPO_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]{1,300}$/;

export type RunnerConfig = { token: string; repo: string };
export type RunnerError = "runner_not_configured" | "invalid_input" | "not_found" | "forbidden" | "unprocessable" | "rate_limited" | "github_error" | "bad_response" | "too_large";

export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: { name: string; number: number; status: string; conclusion: string | null }[];
};
export type Artifact = { id: number; name: string; createdAt: string; sizeInBytes: number; expired: boolean };
export type WorkflowRun = { id: number; htmlUrl: string; status: string; conclusion: string | null };

export function runnerConfigFrom(env: { GITHUB_RUNNER_TOKEN?: string; RUNNER_REPO?: string }): Result<RunnerConfig, "runner_not_configured"> {
  if (!env.GITHUB_RUNNER_TOKEN || !env.RUNNER_REPO) return { ok: false, error: "runner_not_configured" };
  return { ok: true, value: { token: env.GITHUB_RUNNER_TOKEN, repo: env.RUNNER_REPO } };
}

const runsSchema = z.object({
  workflow_runs: z.array(z.object({ id: z.number().int(), display_title: z.string(), created_at: z.string(), html_url: z.string(), status: z.string().nullable(), conclusion: z.string().nullable() })),
});
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      started_at: z.string().nullable().optional(),
      completed_at: z.string().nullable().optional(),
      steps: z.array(z.object({ name: z.string(), number: z.number().int(), status: z.string(), conclusion: z.string().nullable() })).optional(),
    }),
  ),
});
const artifactSchema = z.object({ id: z.number().int(), name: z.string(), created_at: z.string().nullable(), size_in_bytes: z.number().int(), expired: z.boolean(), workflow_run: z.object({ id: z.number().int() }).nullable().optional() });
const artifactsSchema = z.object({ artifacts: z.array(artifactSchema) });
const repoSchema = z.object({ private: z.boolean(), visibility: z.string().optional() });
const treeSchema = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().int().optional() })) });

type Raw = { status: number; headers: Headers; body: unknown; text: string };

function errorFor(r: Raw): RunnerError {
  if (r.status === 404) return "not_found";
  if (r.status === 429 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0")) return "rate_limited";
  if (r.status === 401 || r.status === 403) return "forbidden";
  if (r.status === 422) return "unprocessable";
  return "github_error";
}

/** Reads a body, refusing (null) once it passes `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export function createRunnerClient(cfg: RunnerConfig, fetchFn: typeof fetch = fetch) {
  async function call(method: "GET" | "POST", path: string, opts: { body?: unknown; accept?: string; maxBytes?: number } = {}): Promise<Result<Raw, RunnerError>> {
    let res: Response;
    try {
      res = await fetchFn(`${API}${path}`, {
        method,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: opts.accept ?? "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "arbiter",
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      return { ok: false, error: "github_error" }; // the error text may echo request details; drop it
    }
    const bytes = await readCapped(res, opts.maxBytes ?? MAX_ARTIFACT_BYTES).catch(() => null);
    if (bytes === null) return { ok: false, error: "too_large" };
    const text = new TextDecoder().decode(bytes);
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const raw = { status: res.status, headers: res.headers, body, text };
    if (res.status >= 400) return { ok: false, error: errorFor(raw) };
    return { ok: true, value: raw };
  }

  async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<Result<T, RunnerError>> {
    const r = await call("GET", path);
    if (!r.ok) return r;
    const parsed = schema.safeParse(r.value.body);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "bad_response" };
  }

  const repoOk = (owner: string, repo: string) => NAME_RE.test(owner) && NAME_RE.test(repo);
  const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

  async function getFile(owner: string, repo: string, sha: string, path: string): Promise<Result<string | null, RunnerError>> {
    if (!repoOk(owner, repo) || !SHA_RE.test(sha) || !REPO_PATH_RE.test(path)) return { ok: false, error: "invalid_input" };
    const r = await call("GET", `/repos/${owner}/${repo}/contents/${encPath(path)}?ref=${sha}`, { accept: "application/vnd.github.raw+json", maxBytes: MAX_FILE_BYTES });
    if (!r.ok) return r.error === "not_found" ? { ok: true, value: null } : r;
    return { ok: true, value: r.value.text };
  }

  return {
    async dispatchVerify(i: { runName: string; repoUrl: string; sha: string; deployUrl: string; planB64: string }): Promise<Result<{ dispatchedAt: Date }, RunnerError>> {
      const valid =
        UUID_RE.test(i.runName) && REPO_URL_RE.test(i.repoUrl) && SHA_RE.test(i.sha) && DEPLOY_URL_RE.test(i.deployUrl) && B64_RE.test(i.planB64) && i.planB64.length <= MAX_PLAN_B64;
      if (!valid) return { ok: false, error: "invalid_input" };
      const dispatchedAt = new Date();
      const r = await call("POST", `/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        body: { ref: "main", inputs: { repo_url: i.repoUrl, sha: i.sha, deploy_url: i.deployUrl, run_name: i.runName, plan_b64: i.planB64 } },
      });
      return r.ok ? { ok: true, value: { dispatchedAt } } : r;
    },

    /** The newest run whose run-name is `runName`, created no earlier than a minute before `since`. */
    async findRunByName(runName: string, since: Date): Promise<Result<WorkflowRun | null, RunnerError>> {
      const r = await getJson(`/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`, runsSchema);
      if (!r.ok) return r;
      const notBefore = since.getTime() - 60_000; // clock skew between Arbiter and GitHub
      const match = r.value.workflow_runs
        .filter((w) => w.display_title === runName && Date.parse(w.created_at) >= notBefore)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      return { ok: true, value: match ? { id: match.id, htmlUrl: match.html_url, status: match.status ?? "unknown", conclusion: match.conclusion } : null };
    },

    async getRun(runId: number): Promise<Result<WorkflowRun, RunnerError>> {
      const r = await getJson(`/repos/${cfg.repo}/actions/runs/${runId}`, runsSchema.shape.workflow_runs.element);
      if (!r.ok) return r;
      return { ok: true, value: { id: r.value.id, htmlUrl: r.value.html_url, status: r.value.status ?? "unknown", conclusion: r.value.conclusion } };
    },

    async getJobs(runId: number): Promise<Result<Job[], RunnerError>> {
      const r = await getJson(`/repos/${cfg.repo}/actions/runs/${runId}/jobs?per_page=50`, jobsSchema);
      if (!r.ok) return r;
      return {
        ok: true,
        value: r.value.jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at ?? null, completedAt: j.completed_at ?? null, steps: j.steps ?? [] })),
      };
    },

    async listArtifacts(runId: number): Promise<Result<Artifact[], RunnerError>> {
      const r = await getJson(`/repos/${cfg.repo}/actions/runs/${runId}/artifacts?per_page=100`, artifactsSchema);
      if (!r.ok) return r;
      return { ok: true, value: r.value.artifacts.map((a) => ({ id: a.id, name: a.name, createdAt: a.created_at ?? "", sizeInBytes: a.size_in_bytes, expired: a.expired })) };
    },

    /** The artifact's files, after checking it belongs to `runId` and stays under 8 MB zipped and unzipped. */
    async downloadArtifact(runId: number, artifactId: number): Promise<Result<Record<string, Uint8Array>, RunnerError>> {
      const meta = await getJson(`/repos/${cfg.repo}/actions/artifacts/${artifactId}`, artifactSchema);
      if (!meta.ok) return meta;
      if (meta.value.workflow_run?.id !== runId || meta.value.expired) return { ok: false, error: "not_found" };
      if (meta.value.size_in_bytes > MAX_ARTIFACT_BYTES) return { ok: false, error: "too_large" };
      const r = await call("GET", `/repos/${cfg.repo}/actions/artifacts/${artifactId}/zip`);
      if (!r.ok) return r;
      const location = r.value.headers.get("location");
      if (r.value.status !== 302 || !location?.startsWith("https://")) return { ok: false, error: "bad_response" };
      let zipRes: Response;
      try {
        zipRes = await fetchFn(location, { redirect: "follow" }); // signed URL on another host: no token
      } catch {
        return { ok: false, error: "github_error" };
      }
      if (!zipRes.ok) return { ok: false, error: "github_error" };
      const zip = await readCapped(zipRes, MAX_ARTIFACT_BYTES).catch(() => null);
      if (!zip) return { ok: false, error: "too_large" };
      let declared = 0;
      let count = 0;
      let refused = false;
      let files: Record<string, Uint8Array>;
      try {
        files = unzipSync(zip, {
          filter: (f) => {
            declared += f.originalSize;
            count++;
            if (declared > MAX_ARTIFACT_BYTES || count > MAX_ARTIFACT_FILES) refused = true;
            return !refused;
          },
        });
      } catch {
        return { ok: false, error: "bad_response" };
      }
      if (refused) return { ok: false, error: "too_large" };
      const actual = Object.values(files).reduce((n, b) => n + b.byteLength, 0);
      if (actual > MAX_ARTIFACT_BYTES) return { ok: false, error: "too_large" };
      return { ok: true, value: files };
    },

    async isPublicRepo(owner: string, repo: string): Promise<Result<boolean, RunnerError>> {
      if (!repoOk(owner, repo)) return { ok: false, error: "invalid_input" };
      const r = await getJson(`/repos/${owner}/${repo}`, repoSchema);
      if (!r.ok) return r.error === "not_found" ? { ok: true, value: false } : r;
      return { ok: true, value: !r.value.private && (r.value.visibility ?? "public") === "public" };
    },

    async getRepoTree(owner: string, repo: string, sha: string): Promise<Result<{ path: string; size: number }[], RunnerError>> {
      if (!repoOk(owner, repo) || !SHA_RE.test(sha)) return { ok: false, error: "invalid_input" };
      const r = await getJson(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, treeSchema);
      if (!r.ok) return r;
      return { ok: true, value: r.value.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0 })) };
    },

    getFile,

    /** The named files at the commit; files that do not exist are left out. */
    async getRepoFiles(owner: string, repo: string, sha: string, paths: string[]): Promise<Result<{ path: string; content: string }[], RunnerError>> {
      if (paths.some((p) => !REPO_PATH_RE.test(p))) return { ok: false, error: "invalid_input" };
      const out: { path: string; content: string }[] = [];
      for (const path of paths) {
        const f = await getFile(owner, repo, sha, path);
        if (!f.ok) return f;
        if (f.value !== null) out.push({ path, content: f.value });
      }
      return { ok: true, value: out };
    },
  };
}

export type RunnerClient = ReturnType<typeof createRunnerClient>;

/** The app's client, from GITHUB_RUNNER_TOKEN and RUNNER_REPO; `runner_not_configured` if either is missing. */
export function getRunnerClient(): Result<RunnerClient, "runner_not_configured"> {
  const cfg = runnerConfigFrom(serverEnv());
  return cfg.ok ? { ok: true, value: createRunnerClient(cfg.value) } : cfg;
}
