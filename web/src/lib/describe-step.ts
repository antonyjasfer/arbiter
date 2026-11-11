// Plain-words description of one check-plan step. Shared by the report (what Arbiter ran) and the Evidence
// Reviewer (what the AI may say was verified), so both describe exactly the same checks. An http_get names
// the JSON fields and values it compared, or says the body was not checked (security review I-3, 8 Nov).
export function describeStep(step: Record<string, unknown> | undefined): string {
  if (!step) return "";
  const q = (v: unknown) => `“${String(v)}”`;
  switch (step.op) {
    case "goto":
      return `open ${String(step.path)}`;
    case "fill_by_label":
      return `type ${q(step.value)} into ${q(step.label)}`;
    case "click_by_role":
      return `click the ${String(step.role)} ${q(step.name)}`;
    case "expect_text":
      return `see the text ${q(step.text)}`;
    case "expect_checkbox_checked":
      return `see ${q(step.label)} checked`;
    case "http_get": {
      const head = `GET ${String(step.path)} returns ${String(step.status)}`;
      const json = step.json && typeof step.json === "object" ? Object.entries(step.json as Record<string, unknown>) : [];
      return json.length ? `${head} with JSON ${json.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : `${head} (body not checked)`;
    }
    case "file_exists":
      return `the file ${String(step.path)} exists`;
    case "file_contains":
      return `${String(step.path)} contains ${q(step.text)}`;
    case "package_script_exists":
      return `package.json has a ${q(step.script)} script`;
    case "npm_test":
      return "npm test exits with code 0";
    default:
      return String(step.op ?? "");
  }
}
