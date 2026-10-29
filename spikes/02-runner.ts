// SPIKE 2 (throwaway): dispatch the arbiter-runner `verify` workflow on the fixture repo and read verdicts from the Jobs API.
// Usage: npm run spike:runner -- <pass|fail|probe|reject>
import { mkdirSync, writeFileSync } from "node:fs";
import { requireEnvOrExit } from "./lib/env.js";
import {
  dispatchVerify,
  downloadArtifactFiles,
  getCommitSha,
  InfraTimeoutError,
  parseRepoUrl,
  waitForRun,
  type RunResult,
  type VerifyInput,
} from "./lib/github.js";

const mode = process.argv[2] ?? "";
if (!["pass", "fail", "probe", "reject"].includes(mode)) {
  console.error("usage: npm run spike:runner -- <pass|fail|probe|reject>");
  process.exit(2);
}

const DEPLOY_URL = "https://example.com";
const job = (r: RunResult, name: string) => r.jobs.find((j) => j.name === name);
const step = (r: RunResult, jobName: string, stepName: string) => job(r, jobName)?.steps.find((s) => s.name === stepName)?.conclusion ?? "(missing)";
const ms = (a?: string, b?: string) => (a && b ? Date.parse(b) - Date.parse(a) : NaN);

function printRun(label: string, r: RunResult) {
  const firstStart = r.jobs.map((j) => j.startedAt).filter(Boolean).sort()[0];
  console.log(`\n--- ${label}: run ${r.htmlUrl}`);
  console.log(`run conclusion=${r.conclusion}; queue ~${Math.round(ms(r.createdAt, firstStart) / 1000)}s; total ~${Math.round(ms(r.createdAt, r.updatedAt) / 1000)}s`);
  for (const j of r.jobs) {
    console.log(`  job ${j.name}: ${j.conclusion}`);
    for (const s of j.steps) console.log(`    step ${s.name}: ${s.conclusion}`);
  }
}

async function resolveSha(token: string, fixtureUrl: string, branch: string): Promise<string> {
  const { owner, repo } = parseRepoUrl(fixtureUrl);
  try {
    return await getCommitSha(token, `${owner}/${repo}`, branch);
  } catch {
    // fine-grained token is scoped to arbiter-runner only: fall back to the public, unauthenticated API
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "arbiter-spike" },
    });
    if (!res.ok) throw new Error(`cannot resolve ${owner}/${repo}@${branch}: HTTP ${res.status}`);
    return ((await res.json()) as { sha: string }).sha;
  }
}

async function runOne(env: { GITHUB_RUNNER_TOKEN: string; RUNNER_REPO: string }, input: VerifyInput, skipLocalValidation = false) {
  const d = await dispatchVerify(env, input, { skipLocalValidation });
  console.log(`dispatched: HTTP ${d.dispatchStatus}, run id from response: ${d.runIdFromResponse ? "yes" : "no (matched by run-name)"}, github run ${d.ghRunId}`);
  const result = await waitForRun(env, d.ghRunId, 12 * 60_000);
  return { d, result };
}

async function main() {
  const env = requireEnvOrExit(["GITHUB_RUNNER_TOKEN", "RUNNER_REPO", "FIXTURE_REPO_URL"]);
  const runEnv = { GITHUB_RUNNER_TOKEN: env.GITHUB_RUNNER_TOKEN as string, RUNNER_REPO: env.RUNNER_REPO as string };
  const branch = mode === "reject" ? "pass" : mode;
  const sha = await resolveSha(runEnv.GITHUB_RUNNER_TOKEN, env.FIXTURE_REPO_URL as string, branch);
  console.log(`fixture ${branch} @ ${sha}`);
  const good: VerifyInput = { repoUrl: (env.FIXTURE_REPO_URL as string).replace(/\.git$/, ""), commitSha: sha, runId: String(Date.now()), deployUrl: DEPLOY_URL };
  const out: Record<string, unknown> = { mode, sha, startedAt: new Date().toISOString() };
  let pass = false;

  if (mode === "reject") {
    const cases: [string, Partial<VerifyInput>][] = [
      ["repo_url with shell command", { repoUrl: "https://github.com/a/b;touch /tmp/pwned" }],
      ["commit_sha with shell command", { commitSha: "HEAD;id" }],
      ["deploy_url over http", { deployUrl: "http://example.com" }],
      ["run_id with shell command", { runId: "1;id" }],
    ];
    const verdicts: unknown[] = [];
    pass = true;
    for (const [i, [name, patch]] of cases.entries()) {
      const input = { ...good, runId: patch.runId ?? String(Date.now() + i), ...patch };
      console.log(`\n=== reject case: ${name}`);
      const { result } = await runOne(runEnv, input, true);
      printRun(name, result);
      const rejected =
        job(result, "validate")?.conclusion === "failure" &&
        ["tests", "browser", "canary-holder"].every((n) => job(result, n)?.conclusion === "skipped");
      console.log(`case ${name}: ${rejected ? "REJECTED by validate, nothing else ran" : "NOT REJECTED AS EXPECTED"}`);
      verdicts.push({ name, rejected, url: result.htmlUrl });
      if (!rejected) pass = false;
    }
    out.cases = verdicts;
  } else {
    const { d, result } = await runOne(runEnv, good);
    printRun(mode, result);
    out.dispatch = { status: d.dispatchStatus, runIdFromResponse: d.runIdFromResponse };
    out.run = result;
    try {
      const files = await downloadArtifactFiles(runEnv, d.ghRunId);
      console.log(`artifact files: ${Object.keys(files).join(", ") || "(none)"}`);
      out.artifactFiles = Object.keys(files);
    } catch (e) {
      console.log(`artifact download FAILED: ${e instanceof Error ? e.message : String(e)}`);
      out.artifactError = e instanceof Error ? e.message : String(e);
    }
    const base = job(result, "validate")?.conclusion === "success";
    if (mode === "pass") {
      pass = base && ["tests", "browser", "canary-holder"].every((n) => job(result, n)?.conclusion === "success") &&
        step(result, "tests", "install") === "success" && step(result, "tests", "unit-tests") === "success";
    } else if (mode === "fail") {
      pass = base && job(result, "tests")?.conclusion === "failure" && step(result, "tests", "unit-tests") === "failure" &&
        job(result, "browser")?.conclusion === "success";
      if (pass) console.log("detected the deliberate test failure from the Jobs API: this is the expected verdict");
    } else {
      pass = base && job(result, "canary-holder")?.conclusion === "success" && job(result, "tests")?.conclusion === "success";
      console.log("probe: canary-holder success = the secret exists in this repo; tests success = the untrusted job saw no credential-shaped env vars or tokens");
    }
  }

  out.result = pass ? "PASS" : "FAIL";
  mkdirSync(new URL("./.out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./.out/runner-${mode}.json`, import.meta.url), JSON.stringify(out, null, 2));
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  if (e instanceof InfraTimeoutError) console.error(e.message);
  else console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
