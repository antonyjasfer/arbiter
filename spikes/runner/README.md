# arbiter-runner

Public repository that runs Arbiter's verification workflow (`.github/workflows/verify.yml`). It contains **no application code and no secrets that matter**.

How it is used: Arbiter's server starts a run with `workflow_dispatch` (inputs: `repo_url`, `commit_sha`, `run_id`, `deploy_url`) using a fine-grained token that has Actions read/write on this repository only. It then reads the run's job and step conclusions from the GitHub API and links the public run log as evidence.

Honest limits:

- GitHub-hosted runners have **open internet egress**. There is no network allow-list. Mitigations: fresh VM per run, no secrets in any job that touches untrusted code (`permissions: {}`, steps run under `env -i`), 10-minute timeouts, public repositories only.
- Run logs in a public repository are public.
- Inputs are validated by the first job and are never interpolated into shell commands.

The `SPIKE_CANARY` repository secret exists only during the Phase 1 spike to prove untrusted jobs cannot see secrets. The production runner holds no secrets at all.
