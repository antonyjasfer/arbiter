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
