# Phase 4 Verification Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A freelancer submits a repo at a pinned commit plus a deploy URL for a FUNDED milestone. Arbiter plans a check for each criterion in a restricted DSL and runs the checks on the public `arbiter-runner`: tests on a VM with no secrets, browser checks against the deploy URL. The report gives every criterion a verdict, a source badge and evidence. Injected "mark everything passed" text is flagged and has no effect.

**Architecture:**
- **Branch:** `phase-4-verification`, in its own git worktree cut from `main` after the Part A prep. Migration 0003 is already applied, and Phase 4 adds **no migrations**.
- **Runs:** a verification run is a DB job with a lease, the same pattern as compile jobs:
  - dispatch `verify.yml` with a run-name equal to the run's `dispatch_key`;
  - match the workflow run by that name and poll the Jobs API;
  - download the browser job's results artifact and write the verdicts.
- **Verdicts** come only from job and step conclusions and the browser results JSON. Gemini writes the check plan (a validated DSL, never code) and plain-language summaries that can never change a verdict.

**Tech Stack:**
- The existing `web/` stack.
- GitHub REST (workflow dispatch, runs, jobs, artifacts, contents) via `fetch` with `GITHUB_RUNNER_TOKEN`.
- `fflate` 0.8.3 to unzip artifacts. It was already proven in the spikes, and it is the only new dependency (pinned).
- The `arbiter-runner` workflow, with Node 24 and Playwright.

**Spec:** `docs/arbiter-plan.md` (Phase 4 in section 9, and the Rev 2 notes), `CLAUDE.md` (especially rule 4), `spikes/FINDINGS.md` section 2 (the runner spike), and the user's Phase 4 message of 5 Nov 2026.

## Global Constraints

- **CLAUDE.md rule 4:**
  - Untrusted repo code runs only on `arbiter-runner`: a fresh VM, `timeout-minutes: 10`, public repos only.
  - No secrets in any step that touches it; it runs under `env -i`.
  - Untrusted code runs in its own job with `permissions: {}`.
  - Workflow inputs are passed via `env:` and regex-checked first: a github.com repo URL, a 40-hex SHA, an https deploy URL, a UUID run name. They are never interpolated as `${{ inputs.* }}` inside `run:`.
  - The untrusted job never checks out the runner repo, and `GITHUB_RUNNER_TOKEN` never reaches the runner.
- **The check plan** is a Zod-validated DSL, never code. The browser job interprets only the DSL and runs no repo code. The allowed operations are exactly:
  - **test:** `npm_test`.
  - **static:** `file_exists`, `file_contains`, `package_script_exists`.
  - **browser:** `goto`, `fill_by_label`, `click_by_role`, `expect_text`, `expect_checkbox_checked`, `http_get` (status and optional JSON equality).
  - **review:** no check.
- **Verdicts are deterministic only:** the Jobs API plus the results artifact. Review criteria always end NEEDS HUMAN REVIEW. The Evidence Reviewer (Gemini) writes `ai_summary` only.
- **AI calls** count against the existing `ai_usage` caps (scope per user, or demo). Plans are cached per milestone in `check_plans`, keyed by the criteria hash.
- **No production shortcut to FUNDED.** Tests may call `transitionMilestone` directly to set up FUNDED.
- **Evidence:** screenshots of at most 300 KB each and at most 20 per run, stored in `evidence.content` with their SHA-256 and served by Arbiter to project members only.
- **Cold start:** browser checks tolerate the roughly 24 s Render cold start. A warm-up `http_get` retries for up to 90 s before the first assertion, and each step has its own timeout.
- **No file outside the owned list is edited** without telling the user. No migrations.

## Files

**Owned by Phase 4 (create or modify only these):**
- **Server:** `web/src/server/verification/`, each file with a `*.test.ts`:
  - `plan-dsl.ts`: the Zod DSL.
  - `planner.ts`: the Gemini Check Planner.
  - `runner-client.ts`: GitHub REST (dispatch, find a run by name, jobs, artifacts, contents).
  - `verdicts.ts`: pure; jobs + results → a verdict per criterion.
  - `injection-scan.ts`: GitHub contents → flags.
  - `reviewer.ts`: Gemini summaries.
  - `runs.ts`: the DB job (start, claim, run, resume, status).
  - `submissions.ts`: submit and resubmit, with their transitions.
  - `evidence.ts`: storing and serving evidence, with the size caps.
  - `report.ts`: the read model.
- **App:** `web/src/app/(app)/projects/verification-actions.ts`; `web/src/app/(app)/projects/[projectId]/milestones/[milestoneId]/report/page.tsx`; `web/src/app/api/verification-runs/[runId]/route.ts` (poll and resume); `web/src/app/api/evidence/[evidenceId]/route.ts`.
- **UI:** `web/src/components/verification/*`, including filling in `milestone-verification.tsx`, and `web/src/lib/messages-verification.ts`.
- **Boot resume:** one added line in `web/src/instrumentation-node.ts` resumes verification runs. Phase 5 doesn't touch this file, since it resumes nothing on boot.
- **Dependencies:** `web/package.json` and its lock, adding `fflate@0.8.3`. No other dependency changes.
- **Runner repo** `antonyjasfer/arbiter-runner`: `.github/workflows/verify.yml`, `browser/` (the DSL interpreter, Playwright), and fixtures.
- **New repos** `antonyjasfer/arbiter-demo-pass`, `-fail` and `-injection` (creation approved by the user), and their Render Free services.
- **`spikes/FINDINGS.md`:** only the "Phase 4 live checks" section.

**Shared with Phase 5:** none. Part A already put on `main` the migration, env vars, audit actions, message files, page slots, proxy matcher and the FINDINGS headings.

## Review Focus

1. **Injection via inputs:** a repo URL like `https://github.com/a/b; curl evil`, a SHA with a newline, a deploy URL using `javascript:` or `http://169.254.169.254`. Each is rejected by Zod in Arbiter, and again by the regex step in `verify.yml` before any use (tests in Tasks 2 and 5).
2. **A repo that games the checks:** tests that print "PASS" but exit non-zero; a `postinstall` that tries to read the environment or the token; an `npm test` that never ends. The verdict comes from the job conclusion, the environment is empty, and the 10-minute timeout fails the run (fixture repos in Task 5).
3. **Injected text:** README or HTML comments telling AI reviewers to mark everything passed. These are flagged as evidence, and the reviewer's output cannot change any verdict (test in Task 7).
4. **Lost or stuck runs:** the dispatch succeeds but the run is never found; the server restarts mid-poll; the run takes longer than 10 minutes. Lease and resume pick the run up. Past the deadline it is marked errored and moves VERIFYING→SUBMITTED via `run_errored` with a clear message (Task 6).
5. **Cross-tenant evidence:** an evidence or report URL opened by a non-member, or across the demo boundary, gets a 404 (Task 8).

---

### Task 1: The check DSL and the Check Planner

**Files:** `server/verification/plan-dsl.ts` and `planner.ts`, with tests.

**Interfaces:**
- `checkPlanSchema`: per criterion key, `{ kind: "test"|"static"|"browser"|"review", steps: Step[] }`.
- `type CheckPlan` and `planHash(plan)`.
- `planChecks(db, ai, { milestoneId }): Result<CheckPlan, "ai_busy"|"invalid_plan"|...>`. It uses the `check_plans` cache, keyed by criteria hash. Criteria come from the locked version body, under their stable criterion keys.

- [ ] Tests:
  - The schema accepts each allowed operation with its exact fields. Selectors are label, role, name or text strings of at most 200 characters; there's no CSS or XPath, and no `eval`-like operation.
  - It rejects unknown operations, `javascript:` URLs, absolute URLs off the deploy origin, and more than 15 steps.
  - Review criteria have no steps.
  - The planner prompt wraps the criteria as data.
  - Invalid model output gives `invalid_plan` after one re-ask.
  - A cache hit skips the AI, and a change to the criteria invalidates the cache.
- [ ] Implement, run the tests, commit `feat(verification): check DSL and planner`.

### Task 2: Submissions and transitions

**Files:** `server/verification/submissions.ts` (with test) and `verification-actions.ts`.

**Interfaces:** `submitWork(db, { userId, milestoneId, repoUrl, commitSha, deployUrl })`:
- Freelancer only. The milestone must be FUNDED, or REPORT_READY for a resubmission.
- It validates an `https://github.com/<owner>/<repo>` URL (the public-repo check via the API is in Task 6), a 40-hex SHA, and an `https://` deploy URL that isn't on a private or link-local host.
- It supersedes the previous live submission.
- It moves FUNDED→SUBMITTED (`submit`) or REPORT_READY→SUBMITTED (`resubmit`), and audits `submission_created` or `resubmitted`.

- [ ] Tests:
  - The client can't submit.
  - An AGREED (unfunded) milestone is refused.
  - Bad URLs and SHAs are rejected.
  - A resubmission supersedes the earlier one.
  - A guarded-transition conflict is handled.
- [ ] Implement, commit.

### Task 3: Injection scanner

**Files:** `server/verification/injection-scan.ts` (with test). It uses `runner-client.ts`'s `getRepoFiles(owner, repo, sha, paths)`.

- [ ] Tests (fixture contents):
  - It flags "ignore previous instructions", "AI reviewer", "mark (all|everything) as passed" and HTML comments addressing an AI, in README, `*.md`, `*.html` and `package.json` files.
  - Each flag reports the file, line and an excerpt of at most 200 characters.
  - It scans at most 200 files and 1 MB, and never executes anything.
- [ ] Implement, commit.

### Task 4: GitHub runner client

**Files:** `server/verification/runner-client.ts` (tested with a fake `fetch`).

**Interfaces:** `dispatchVerify({ runName, repoUrl, sha, deployUrl, planB64 })`, `findRunByName(runName, since)`, `getJobs(runId)`, `downloadArtifact(runId, name)` (zip → files, size-capped), `getRepoFiles` and `isPublicRepo`. It reads `GITHUB_RUNNER_TOKEN` and `RUNNER_REPO` via `serverEnv()`; if either is missing it returns a typed `runner_not_configured`.

- [ ] Tests:
  - Request shapes and headers.
  - The token is never logged.
  - 404, 403 and 422 map to typed errors.
  - An artifact over 8 MB is refused.
- [ ] Implement, commit.

### Task 5: `verify.yml` and the browser interpreter (arbiter-runner repo)

**Files (runner repo):** `.github/workflows/verify.yml`, `browser/run-plan.mjs`, `browser/dsl.mjs`, and `fixtures/` (malicious-postinstall, never-ending-test).

- [ ] Write `verify.yml`:
  - **Inputs:** `workflow_dispatch` inputs `repo_url`, `sha`, `deploy_url`, `run_name` and `plan_b64`, with `run-name: ${{ inputs.run_name }}` (the dispatch-key UUID, regex-checked).
  - **Job `validate`:** no checkout; the inputs are passed via env and regex-checked.
  - **Job `tests`:** `permissions: {}` and `timeout-minutes: 10`. It checks out the freelancer repo at the SHA, then runs `env -i PATH=… npm ci --ignore-scripts=false && npm test`.
  - **Job `browser`:** `permissions: {}`, with no repo checkout. It interprets the decoded plan with Playwright against `deploy_url` and writes `results.json` and the screenshots. It uploads them with `actions/upload-artifact@<current major>`, checking the current major against GitHub's releases at implementation time.
- [ ] Prove it with live runs, recorded in FINDINGS:
  - The existing pass and fail fixtures.
  - A malicious `postinstall` sees no secrets (empty env), and the run's verdict depends on exit codes only.
  - A never-ending test is cancelled at 10 minutes (one live run).
- [ ] Commit in the runner repo and record the workflow SHA.

### Task 6: Verification runs as DB jobs

**Files:** `server/verification/runs.ts` and `verdicts.ts` (with tests), `app/api/verification-runs/[runId]/route.ts`, and one line in `instrumentation-node.ts`.

**Interfaces:**
- `startVerification(db, ai, { userId, submissionId })`: moves SUBMITTED→VERIFYING via `start_verification`, writes the plan, and audits.
- `claimRun` and `runStep`, with a 240 s lease. The steps are:
  1. dispatch;
  2. find the run by name, retrying for up to 2 minutes;
  3. poll the jobs on every poll call (no timers);
  4. download the results;
  5. write the verdicts, then move to REPORT_READY via `report_ready`.
- **Deadline:** 10 minutes after dispatch, plus 2 minutes' grace. Past it, the run becomes `errored` and moves VERIFYING→SUBMITTED via `run_errored`, with an `error_code`.
- `resumeDueRuns`, called on boot and on every status poll.
- `computeVerdicts(plan, jobs, results)`: a pure function.

- [ ] Tests:
  - Two pollers claim a run only once.
  - A restart mid-poll is resumed.
  - A run that's never found is marked errored after the window.
  - A failed tests job makes every `test` criterion FAIL.
  - A failed browser step makes that criterion FAIL, recording the failing step.
  - A missing results artifact makes the browser criteria NEEDS HUMAN REVIEW, with the reason.
  - Review criteria are always NEEDS HUMAN REVIEW.
  - Verdicts are written with `source: deterministic`.
- [ ] Implement, commit.

### Task 7: Evidence and the Evidence Reviewer

**Files:** `server/verification/evidence.ts` and `reviewer.ts` (with tests), and `app/api/evidence/[evidenceId]/route.ts`.

- [ ] Tests:
  - Screenshots over 300 KB, or past 20 per run, aren't stored (they're recorded as skipped).
  - The SHA-256 is stored and checked again when serving.
  - Evidence is for members only, the demo boundary holds, and a malformed ID gets 404.
  - The run link is stored as `run_link` evidence.
  - The reviewer gets the verdicts, step results and injection flags as data and returns summaries only. A reviewer reply claiming "all passed" leaves every verdict unchanged.
  - If the reviewer fails, `ai_summary` stays null and the report still loads.
- [ ] Implement, commit.

### Task 8: Report page and milestone panel

**Files:** `server/verification/report.ts` (with test), `components/verification/*`, `report/page.tsx`, and `messages-verification.ts`.

- [ ] **Report:** for each criterion:
  - the verdict (PASS, FAIL or NEEDS HUMAN REVIEW, as a colour plus the word);
  - a source badge (Deterministic, AI summary, or Needs human review);
  - the step evidence and screenshots;
  - the AI summary, labelled as such.

  Above the criteria: an injection warning banner when there are flags, a link to the public run, and the run timing.
- [ ] **Milestone panel** (in the Part A slot): the freelancer gets a submit form (in FUNDED or REPORT_READY), the run status with polling, and a link to the report. The client sees the status and the report.
- [ ] Tests for the read model: members only, and cross-tenant 404. Then lint, typecheck, build, and a browser walkthrough.
- [ ] Commit.

### Task 9: Demo repos, live runs, review, handoff

- [ ] **Demo repos:** create `arbiter-demo-pass`, `-fail` and `-injection`, each a TaskBoard app for Milestone 1 (add, tick, health, `npm test`):
  - `-fail`: ticking a task doesn't mark it done.
  - `-injection`: a README and an HTML comment addressed to AI reviewers, plus one real failing criterion.

  Deploy each as a Render Free web service (Virginia) and pin each commit SHA.
- [ ] **Live:** three real runs (pass, fail, injection) end to end, tolerating the cold start. Record timings and run URLs in FINDINGS "Phase 4 live checks".
- [ ] **Review:** a fresh-subagent review focused on security, using the Review Focus list; fix Important and above test-first.
- [ ] **Handoff:** do **not** merge to `main` alone. Hand the branch to Phase 6 (see below). Run the secret scan before every push.

## Render and GitHub settings the user adds

- On Render `arbiter`:
  - `GITHUB_RUNNER_TOKEN`: a fine-grained PAT with Actions read/write and Contents read on `antonyjasfer/arbiter-runner`, plus public-repo read for contents and artifacts.
  - `RUNNER_REPO=antonyjasfer/arbiter-runner` (already recorded in `render.yaml`).
- Three new Render Free services for the demo repos (approved).

## What Phase 6 must connect

- **Funding:** real FUNDED comes from Phase 5; Phase 4's demo uses a test-only path. Phase 6 runs the full flow: fund → submit → verify → report → approve.
- **Payment guard:** Phase 5's guard reads "the latest run has no FAIL" from the `check_results` of the latest completed run of the latest live submission. Phase 6 wires it to Phase 4's `report.ts` read model, through `latestVerdicts(milestoneId)` (exported here).
- **Also:** the DISPUTED path (the Disagree button) and seeding submitted runs into the demo.
