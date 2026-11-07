import { ExternalLink, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Tone } from "@/lib/format";
import { STEP_REASON_TEXT } from "@/lib/messages-verification";
import type { Report, ReportCriterion, VerdictSource } from "@/server/verification/report";

const VERDICT: Record<ReportCriterion["verdict"], { label: string; tone: Tone }> = {
  pass: { label: "PASS", tone: "pass" },
  fail: { label: "FAIL", tone: "fail" },
  needs_review: { label: "NEEDS HUMAN REVIEW", tone: "review" },
};
const SOURCE: Record<VerdictSource, string> = {
  deterministic: "Deterministic: checked by Arbiter",
  freelancer_suite: "Freelancer's own test suite",
  human_review: "Needs human review",
};
const timeIst = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const reason = (r: unknown) => (typeof r === "string" ? (STEP_REASON_TEXT[r] ?? r) : null);

function describeStep(step: Record<string, unknown> | undefined): string {
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
    case "http_get":
      return `GET ${String(step.path)} returns ${String(step.status)}${step.json ? " with the expected JSON" : ""}`;
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

type Detail = { kind?: string; reason?: string | null; why?: string; failed_step?: number | string | null; job_conclusion?: string | null; steps?: { index: number; status: string; reason?: string | null; ms?: number; actual_status?: number | null }[] };

function CriterionCard({ c }: { c: ReportCriterion }) {
  const v = VERDICT[c.verdict];
  const d = (c.detail ?? {}) as Detail;
  const shots = c.evidence.filter((e) => e.type === "screenshot");
  return (
    <li className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl font-medium">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{c.key}</span>
          {c.text}
        </p>
        <StatusBadge tone={v.tone}>{v.label}</StatusBadge>
      </div>
      <p className="text-xs text-muted-foreground">
        Source: <span className="font-medium text-foreground">{SOURCE[c.source]}</span>
        {c.source === "freelancer_suite" ? " (tests the freelancer wrote; weaker evidence than checks Arbiter runs)" : null}
      </p>

      {c.kind === "test" ? (
        <p className="text-sm">
          npm test on the runner: <span className="font-mono">{d.job_conclusion ?? "did not run"}</span>
          {d.failed_step ? ` (failed at “${String(d.failed_step)}”)` : null}
          {d.reason ? ` · ${reason(d.reason)}` : null}
        </p>
      ) : null}

      {c.kind === "browser" || c.kind === "static" ? (
        d.steps && d.steps.length ? (
          <ol className="flex flex-col gap-1 text-sm">
            {d.steps.map((s) => (
              <li key={s.index} className="flex flex-wrap items-baseline gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">Step {s.index + 1}</span>
                <span className={s.status === "fail" ? "text-status-fail" : s.status === "skipped" ? "text-muted-foreground" : undefined}>
                  {s.status === "pass" ? "✓" : s.status === "fail" ? "✗" : "–"} {describeStep(c.steps[s.index])}
                  {s.status === "fail" && s.reason ? `: ${reason(s.reason)}` : null}
                  {s.status === "skipped" ? " (not run)" : null}
                </span>
              </li>
            ))}
          </ol>
        ) : d.reason ? (
          <p className="text-sm">Not decided by a check: {reason(d.reason)}{d.why ? ` (${reason(d.why)})` : null}.</p>
        ) : null
      ) : null}
      {c.kind === "browser" && d.reason && d.steps?.length ? <p className="text-sm text-muted-foreground">Result: {reason(d.reason)}</p> : null}

      {shots.length ? (
        <div className="flex flex-wrap gap-3">
          {shots.map((e) =>
            e.stored ? (
              <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" rel="noreferrer" className="flex flex-col gap-1 text-xs text-muted-foreground">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by Arbiter's members-only evidence route */}
                <img src={`/api/evidence/${e.id}`} alt={`Screenshot after ${e.label ?? "a step"} for ${c.key}`} className="h-32 w-auto rounded border object-cover object-top" loading="lazy" />
                {e.label}
              </a>
            ) : (
              <p key={e.id} className="text-xs text-muted-foreground">
                {e.label}
              </p>
            ),
          )}
        </div>
      ) : null}

      {c.aiSummary ? (
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">AI summary (explains the result; it cannot change the verdict)</p>
          <p>{c.aiSummary}</p>
        </div>
      ) : null}
    </li>
  );
}

export function ReportView({ report }: { report: Report }) {
  const runLink = report.runEvidence.find((e) => e.type === "run_link");
  const results = report.runEvidence.find((e) => e.type === "results" && e.stored);
  const counts = { pass: 0, fail: 0, needs_review: 0 };
  for (const c of report.criteria) counts[c.verdict]++;
  const secs = report.run.startedAt && report.run.finishedAt ? Math.round((report.run.finishedAt.getTime() - report.run.startedAt.getTime()) / 1000) : null;
  return (
    <div className="flex flex-col gap-5">
      {report.injectionFlags.length ? (
        <div role="alert" className="flex gap-3 rounded-xl border border-status-review/40 bg-status-review/10 p-4 text-sm">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">The repository contains text addressed to AI reviewers ({report.injectionFlags.length} found)</p>
            <p>Arbiter flagged it and ignored it. Verdicts come only from the tests and browser checks below.</p>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
              {report.injectionFlags.slice(0, 10).map((f, i) => (
                <li key={i} className="break-all">
                  {f.file}:{f.line} “{f.excerpt}”
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span className="flex gap-2">
          <StatusBadge tone="pass">{counts.pass} PASS</StatusBadge>
          <StatusBadge tone="fail">{counts.fail} FAIL</StatusBadge>
          <StatusBadge tone="review">{counts.needs_review} NEEDS HUMAN REVIEW</StatusBadge>
        </span>
        {report.run.finishedAt ? <span>Finished {timeIst.format(report.run.finishedAt)} IST{secs !== null ? ` · ${Math.floor(secs / 60)} min ${secs % 60} s` : ""}</span> : null}
        {runLink ? (
          <a href={runLink.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
            Public run log <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
        {results ? (
          <a href={`/api/evidence/${results.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            results.json
          </a>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Repository <span className="font-mono text-xs">{report.submission.repoUrl.replace("https://github.com/", "")}</span> at commit{" "}
        <span className="font-mono text-xs">{report.submission.commitSha}</span>, site <span className="font-mono text-xs break-all">{report.submission.deployUrl}</span>
      </p>

      <ol className="flex flex-col gap-3">
        {report.criteria.map((c) => (
          <CriterionCard key={c.key} c={c} />
        ))}
      </ol>
    </div>
  );
}
