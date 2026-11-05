// Plain-language text for every error code the server returns. Shown inline next to the action.
export const ERROR_TEXT: Record<string, string> = {
  invalid_input: "Check the title, brief (40 to 4,000 characters) and budget ($50 to $5,000).",
  control_characters: "Remove hidden control characters (often pasted in with the text) from the title, brief or answers.",
  not_member: "This project isn't available to you.",
  not_found: "This project isn't available to you.",
  forbidden: "Only the client can do that.",
  stale: "The agreement changed. Review the new version, then approve it.",
  locked: "The agreement is locked. Nothing can change now.",
  no_version: "There is no agreement to work on yet.",
  job_running: "The AI is already drafting this agreement.",
  demo_cap: "The demo has used today's AI drafts. You can still edit the agreement by hand; AI drafting resets at 05:30 IST.",
  daily_cap: "You've used today's 10 AI drafts. You can still edit the agreement by hand; AI drafting resets at 05:30 IST.",
  has_freelancer: "A freelancer has already joined this project.",
  invalid: "This invite link isn't valid. It may have been used or expired; ask the client for a new one.",
  own_project: "This is your own project's invite. Send it to your freelancer.",
  not_demo: "Only demo users can reset the demo.",
  too_soon: "The demo was reset a moment ago. Try again in 30 seconds.",
  unauthenticated: "Sign in first.",
};

export const PROBLEM_TEXT: Record<string, string> = {
  sum_mismatch: "The milestone amounts must add up to the budget exactly.",
  below_minimum: "Each milestone must be at least $50.00.",
  too_many_milestones: "Use 1 to 6 milestones.",
  empty_criteria: "Each milestone needs 1 to 8 acceptance criteria.",
  duplicate_title: "Each milestone needs its own title.",
  invalid_keys: "The agreement's milestone or criterion IDs don't match the version you edited. Reload the page and edit again.",
  control_characters: "Remove hidden control characters (often pasted in with the text) from the titles and criteria.",
  invalid_shape: "Something in the agreement is out of range (titles up to 120 characters, criteria up to 500, due within 90 days, at most $5,000 a milestone).",
};

export const JOB_ERROR_TEXT: Record<string, string> = {
  ai_busy: "The AI stayed busy after four tries.",
  invalid_output: "The AI's reply wasn't a valid agreement, even after it was asked again.",
  checks_failed: "The AI's draft broke the agreement rules.",
  error: "The AI request failed.",
};

export function errorText(code: string): string {
  return ERROR_TEXT[code] ?? "Something went wrong. Try again.";
}
