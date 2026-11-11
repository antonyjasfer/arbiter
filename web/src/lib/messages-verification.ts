// Phase 4 (verification) error codes -> plain-language text. Owned by the phase-4-verification branch.
// Looked up through errorText() in messages.ts, after the shared ERROR_TEXT.
export const VERIFICATION_ERROR_TEXT: Record<string, string> = {
  // Submitting
  invalid_repo_url: "Enter a public GitHub repository as https://github.com/owner/repo.",
  invalid_sha: "Enter the full 40-character commit SHA (git rev-parse HEAD).",
  invalid_deploy_url: "Enter the https address of the deployed site. Local, private and IP addresses are not allowed.",
  wrong_state: "This milestone cannot take that action right now. Refresh the page.",
  // Starting a run
  repo_not_public: "Arbiter only verifies public repositories. Make the repository public, then retry.",
  github_error: "GitHub could not be reached. Try again in a minute.",
  runner_not_configured: "The verification runner is not configured on this server.",
  ai_error: "The AI that plans the checks failed. Try again.",
  invalid_plan: "The AI could not produce a valid check plan. Try again.",
  // A run that ended without a report (the milestone goes back to Submitted)
  dispatch_failed: "GitHub refused to start the verification run.",
  run_not_found: "The verification run never appeared on GitHub.",
  deadline_exceeded: "The verification run took longer than 25 minutes and was stopped.",
  unexpected_artifacts: "The run's results were tampered with (an unexpected or missing results artifact), so no verdict was written.",
  bad_results: "The run's results file was invalid or belonged to another run, so no verdict was written.",
  runner_error: "The verification runner itself failed (not the submitted code), so no verdict was written. Run verification again.",
};

// FAILs caused by the deployed site, with what the freelancer should do (user decision, 8 Nov).
export const SITE_FAIL_TEXT: Record<string, string> = {
  site_unreachable: "Site didn't respond within 90 s; fix the deploy and resubmit.",
  budget_exhausted: "The site was too slow for the checks to finish in time; fix the deploy and resubmit.",
  timeout: "A step timed out on the deployed site; fix the deploy and resubmit.",
};

// Browser and test step reason codes from results.json and the Jobs API -> text for the report.
export const STEP_REASON_TEXT: Record<string, string> = {
  timeout: "timed out",
  not_found: "not found on the page",
  ambiguous: "matched more than one element",
  navigation_failed: "the page did not load",
  http_error: "the request failed",
  status_mismatch: "wrong HTTP status",
  json_mismatch: "the JSON did not match",
  not_json: "the response was not JSON",
  not_checked: "not checked",
  origin_mismatch: "redirected to another site",
  budget_exhausted: "the checks ran out of time on the deployed site",
  site_unreachable: "the site didn't respond within 90 s",
  error: "the check could not run",
  results_missing: "the browser results were not uploaded",
  plan_invalid: "the runner rejected the check plan",
  no_result: "no result was recorded",
  review_criterion: "this criterion needs a person to judge it",
  tests_not_run: "the test suite did not run",
};
