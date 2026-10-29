// Spike helper (throwaway). Minimal GitHub REST client for dispatching and reading the arbiter-runner workflow.
// Sources: GitHub REST docs: "Create a workflow dispatch event", "Workflow runs", "Workflow jobs", "Artifacts".
import { unzipSync } from "fflate";

export const API = "https://api.github.com";
export const WORKFLOW_FILE = "verify.yml";

// The SAME patterns as the workflow's `validate` job (spikes/runner/.github/workflows/verify.yml).
export const REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const RUN_ID_RE = /^[0-9]{1,18}$/;
export const DEPLOY_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[!-~]*)?$/;

export type VerifyInput = { repoUrl: string; commitSha: string; runId: string; deployUrl: string };

export class GitHubError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`GitHub ${status}: ${message}`);
    this.name = "GitHubError";
  }
}

export class InfraTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfraTimeoutError";
  }
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const trimmed = url.endsWith(".git") ? url.slice(0, -4) : url;
  if (!REPO_URL_RE.test(trimmed)) throw new Error("Not a plain https://github.com/<owner>/<repo> URL");
  const [, , , owner, repo] = trimmed.split("/");
  return { owner: owner as string, repo: repo as string };
}

export function validateVerifyInputs(i: VerifyInput): string[] {
  const problems: string[] = [];
  if (!REPO_URL_RE.test(i.repoUrl)) problems.push("repo_url must be https://github.com/<owner>/<repo>");
  if (!SHA_RE.test(i.commitSha)) problems.push("commit_sha must be 40 lowercase hex characters");
  if (!RUN_ID_RE.test(i.runId)) problems.push("run_id must be 1-18 digits");
  if (!DEPLOY_URL_RE.test(i.deployUrl)) problems.push("deploy_url must be an https URL without spaces");
  return problems;
}

export function matchRunByTitle(
  runs: { id: number; display_title: string; created_at: string }[],
  runId: string,
  notBefore: Date,
): number | undefined {
  const matches = runs
    .filter((r) => r.display_title === `verify ${runId}` && Date.parse(r.created_at) >= notBefore.getTime())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return matches[0]?.id;
}

export async function ghFetch<T>(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "arbiter-spike",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  if (!res.ok && res.status !== 302) {
    throw new GitHubError(res.status, (parsed as { message?: string } | undefined)?.message ?? "request failed");
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

type RunEnv = { GITHUB_RUNNER_TOKEN: string; RUNNER_REPO: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getCommitSha(token: string, ownerRepo: string, branch: string): Promise<string> {
  const r = await ghFetch<{ sha: string }>(token, "GET", `/repos/${ownerRepo}/commits/${encodeURIComponent(branch)}`);
  return r.body.sha;
}

export async function dispatchVerify(
  env: RunEnv,
  input: VerifyInput,
  opts: { skipLocalValidation?: boolean } = {},
): Promise<{ ghRunId: number; dispatchStatus: number; runIdFromResponse: boolean; dispatchedAt: Date }> {
  if (!opts.skipLocalValidation) {
    const problems = validateVerifyInputs(input);
    if (problems.length) throw new Error(`Refusing to dispatch: ${problems.join("; ")}`);
  }
  const dispatchedAt = new Date(Date.now() - 2000);
  const res = await ghFetch<{ workflow_run_id?: number } | undefined>(
    env.GITHUB_RUNNER_TOKEN,
    "POST",
    `/repos/${env.RUNNER_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    { ref: "main", inputs: { repo_url: input.repoUrl, commit_sha: input.commitSha, run_id: input.runId, deploy_url: input.deployUrl } },
  );
  const fromResponse = res.body?.workflow_run_id;
  if (typeof fromResponse === "number") {
    return { ghRunId: fromResponse, dispatchStatus: res.status, runIdFromResponse: true, dispatchedAt };
  }
  for (let waited = 0; waited < 60; waited += 3) {
    await sleep(3000);
    const list = await ghFetch<{ workflow_runs: { id: number; display_title: string; created_at: string }[] }>(
      env.GITHUB_RUNNER_TOKEN,
      "GET",
      `/repos/${env.RUNNER_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`,
    );
    const id = matchRunByTitle(list.body.workflow_runs, input.runId, dispatchedAt);
    if (id !== undefined) return { ghRunId: id, dispatchStatus: res.status, runIdFromResponse: false, dispatchedAt };
  }
  throw new InfraTimeoutError(`INFRA_TIMEOUT: dispatched at ${dispatchedAt.toISOString()} with run-name "verify ${input.runId}" but no run appeared within 60s`);
}

export type RunResult = {
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  jobs: { name: string; conclusion: string | null; startedAt?: string; completedAt?: string; steps: { name: string; conclusion: string | null }[] }[];
};

export async function waitForRun(env: RunEnv, ghRunId: number, timeoutMs: number): Promise<RunResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await ghFetch<{ status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string }>(
      env.GITHUB_RUNNER_TOKEN,
      "GET",
      `/repos/${env.RUNNER_REPO}/actions/runs/${ghRunId}`,
    );
    if (run.body.status === "completed") {
      const jobs = await ghFetch<{
        jobs: { name: string; conclusion: string | null; started_at?: string; completed_at?: string; steps?: { name: string; conclusion: string | null }[] }[];
      }>(env.GITHUB_RUNNER_TOKEN, "GET", `/repos/${env.RUNNER_REPO}/actions/runs/${ghRunId}/jobs?per_page=50`);
      return {
        status: run.body.status,
        conclusion: run.body.conclusion,
        htmlUrl: run.body.html_url,
        createdAt: run.body.created_at,
        updatedAt: run.body.updated_at,
        jobs: jobs.body.jobs.map((j) => ({
          name: j.name,
          conclusion: j.conclusion,
          startedAt: j.started_at,
          completedAt: j.completed_at,
          steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion })),
        })),
      };
    }
    if (Date.now() > deadline) {
      throw new InfraTimeoutError(`INFRA_TIMEOUT: run ${ghRunId} still ${run.body.status} after ${Math.round(timeoutMs / 1000)}s (${run.body.html_url})`);
    }
    await sleep(5000);
  }
}

// Only these artifact names are accepted. `tests` uploads none (untrusted VM); anything unexpected means tampering.
export const ALLOWED_ARTIFACTS = new Set(["browser-screenshot"]);

export async function downloadArtifactFiles(env: RunEnv, ghRunId: number): Promise<Record<string, Uint8Array>> {
  const list = await ghFetch<{ artifacts: { id: number; name: string; expired: boolean }[] }>(
    env.GITHUB_RUNNER_TOKEN,
    "GET",
    `/repos/${env.RUNNER_REPO}/actions/runs/${ghRunId}/artifacts?per_page=50`,
  );
  const out: Record<string, Uint8Array> = {};
  const unexpected = list.body.artifacts.filter((x) => !ALLOWED_ARTIFACTS.has(x.name)).map((x) => x.name);
  if (unexpected.length) throw new Error(`unexpected artifact(s) in run ${ghRunId}: ${unexpected.join(", ")}`);
  for (const a of list.body.artifacts.filter((x) => !x.expired)) {
    const r = await ghFetch<unknown>(env.GITHUB_RUNNER_TOKEN, "GET", `/repos/${env.RUNNER_REPO}/actions/artifacts/${a.id}/zip`);
    const location = r.headers.get("location");
    if (r.status !== 302 || !location) throw new GitHubError(r.status, `artifact ${a.name}: expected a 302 redirect`);
    // The signed URL is on another host; do NOT send the GitHub token there.
    const zip = await fetch(location);
    if (!zip.ok) throw new GitHubError(zip.status, `artifact ${a.name}: download failed`);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    for (const [name, data] of Object.entries(files)) out[`${a.name}/${name}`] = data;
  }
  return out;
}
