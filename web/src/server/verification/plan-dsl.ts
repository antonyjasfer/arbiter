// The check plan: a restricted DSL the Check Planner writes and arbiter-runner interprets. It is data,
// never code: no CSS/XPath selectors, no script evaluation, no absolute URLs. Browser steps address the
// deployed site by path only (the runner joins the path to the submission's deploy_url), because a plan
// is cached per milestone and reused across resubmissions with different deploy URLs.
// The same rules are re-checked by the runner's interpreter (arbiter-runner browser/dsl.mjs).
import { z } from "zod";
import { canonicalJson, sha256Hex } from "@/lib/canonical-json";
import { CRITERION_KEY } from "../agreements/body";

export const MAX_STEPS = 15;
const NO_CONTROL = /^[^\u0000-\u001F\u007F]*$/;

/** A visible label, role name or text: plain text only, at most 200 characters. */
const selectorText = z.string().min(1).max(200).regex(NO_CONTROL, "no control characters");
const valueText = z.string().max(500).regex(NO_CONTROL, "no control characters");

/** A path on the deployed site: starts with one "/", printable ASCII, no spaces or backslashes. */
export const sitePath = z
  .string()
  .max(500)
  .regex(/^\/(?![/\\])[!-[\]-~]*$/, "a path starting with a single /, without spaces or backslashes");

/** A path inside the repository: relative, no "..", no backslashes or drive letters. */
const repoPath = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/, "a relative repository path");

export const ROLES = ["button", "link", "checkbox", "textbox", "heading", "tab", "menuitem", "option", "radio", "switch"] as const;

// JSON equality values are strings, booleans, integers or null: canonicalJson (planHash) has no floats.
const jsonScalar = z.union([z.string().max(200), z.boolean(), z.number().int().min(-1e9).max(1e9), z.null()]);

export const browserStepSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("goto"), path: sitePath }),
  z.strictObject({ op: z.literal("fill_by_label"), label: selectorText, value: valueText }),
  z.strictObject({ op: z.literal("click_by_role"), role: z.enum(ROLES), name: selectorText }),
  z.strictObject({ op: z.literal("expect_text"), text: selectorText }),
  z.strictObject({ op: z.literal("expect_checkbox_checked"), label: selectorText }),
  z.strictObject({
    op: z.literal("http_get"),
    path: sitePath,
    status: z.number().int().min(100).max(599),
    json: z.record(z.string().min(1).max(100), jsonScalar).refine((o) => Object.keys(o).length <= 10, "at most 10 keys").optional(),
  }),
]);

export const staticStepSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("file_exists"), path: repoPath }),
  z.strictObject({ op: z.literal("file_contains"), path: repoPath, text: selectorText }),
  z.strictObject({ op: z.literal("package_script_exists"), script: z.string().regex(/^[A-Za-z0-9:._-]{1,50}$/) }),
]);

export const testStepSchema = z.strictObject({ op: z.literal("npm_test") });

export const criterionPlanSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("test"), steps: z.tuple([testStepSchema]) }),
  z.strictObject({ kind: z.literal("static"), steps: z.array(staticStepSchema).min(1).max(MAX_STEPS) }),
  z.strictObject({ kind: z.literal("browser"), steps: z.array(browserStepSchema).min(1).max(MAX_STEPS) }),
  z.strictObject({ kind: z.literal("review"), steps: z.array(z.never()).max(0) }),
]);

export const checkPlanSchema = z.record(z.string().regex(CRITERION_KEY), criterionPlanSchema);

export type BrowserStep = z.infer<typeof browserStepSchema>;
export type StaticStep = z.infer<typeof staticStepSchema>;
export type CriterionPlan = z.infer<typeof criterionPlanSchema>;
export type CheckPlan = z.infer<typeof checkPlanSchema>;

/** sha256 of the plan's canonical JSON: the same plan always has the same hash, whatever its key order. */
export function planHash(plan: CheckPlan): string {
  return sha256Hex(canonicalJson(plan));
}

// ---------------------------------------------------------------------------------------------------------
// results.json: written by the trusted browser job (arbiter-runner browser/run-plan.mjs) and uploaded as the
// single artifact "arbiter-results". It carries only fixed reason codes, plan keys and numbers, never text
// from the deployed site, so nothing the site renders can reach a verdict or a model prompt through it.
// plan_sha256 is the sha256 of the decoded plan_b64 bytes Arbiter dispatched, binding results to that plan.
export const RESULTS_ARTIFACT = "arbiter-results";
export const RESULTS_FILE = "results.json";
export const STEP_REASONS = [
  "timeout", "not_found", "ambiguous", "navigation_failed", "http_error", "status_mismatch", "json_mismatch",
  "not_json", "not_checked", "origin_mismatch", "budget_exhausted", "site_unreachable", "error",
] as const;
export const BROWSER_OPS = ["goto", "fill_by_label", "click_by_role", "expect_text", "expect_checkbox_checked", "http_get"] as const;
const RUN_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const stepIndex = z.number().int().min(0).max(MAX_STEPS - 1);
const httpStatus = z.number().int().min(0).max(999);
const ms = z.number().int().min(0).max(3_600_000);
const reason = z.enum(STEP_REASONS);

export const stepResultSchema = z.strictObject({
  index: stepIndex,
  op: z.enum(BROWSER_OPS),
  status: z.enum(["pass", "fail", "skipped"]),
  reason: reason.nullable(),
  ms,
  actual_status: httpStatus.nullable(),
  mismatched_keys: z.array(z.string().min(1).max(100)).max(10),
  screenshot: z.string().regex(/^shots\/\d{1,2}\.jpg$/).nullable(),
});

export const criterionResultSchema = z
  .strictObject({
    status: z.enum(["pass", "fail", "error"]),
    failed_step: stepIndex.nullable(),
    reason: reason.nullable(),
    steps: z.array(stepResultSchema).max(MAX_STEPS),
  })
  .refine(
    (c) =>
      c.status === "pass"
        ? c.failed_step === null && c.reason === null && c.steps.every((s) => s.status === "pass")
        : c.status === "fail"
          ? c.failed_step !== null && c.reason !== null && c.steps[c.failed_step]?.status === "fail"
          : c.failed_step === null && c.reason !== null,
    "status, failed_step and reason disagree",
  );

export const resultsSchema = z.strictObject({
  version: z.literal(1),
  run_name: z.string().regex(RUN_NAME),
  plan_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["ok", "plan_invalid", "site_unreachable"]),
  plan_error: z.string().max(200).regex(/^[ -~]*$/).nullable(),
  warmup: z.strictObject({ ok: z.boolean(), attempts: z.number().int().min(0).max(100), ms, status: httpStatus.nullable() }),
  criteria: z.record(z.string().regex(CRITERION_KEY), criterionResultSchema),
  screenshots_skipped: z.number().int().min(0).max(1000),
});

export type StepResult = z.infer<typeof stepResultSchema>;
export type CriterionResult = z.infer<typeof criterionResultSchema>;
export type Results = z.infer<typeof resultsSchema>;
