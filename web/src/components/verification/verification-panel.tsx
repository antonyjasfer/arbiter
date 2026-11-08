"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { startVerificationAction, submitWorkAction } from "@/app/(app)/projects/verification-actions";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { pollDelay } from "@/lib/format";
import { errorText } from "@/lib/messages";

type Run = { id: string; status: string; errorCode: string | null; runUrl: string | null; createdAt: string };
type Submission = { id: string; repoUrl: string; commitSha: string; deployUrl: string; createdAt: string };

export function VerificationPanel(props: {
  projectId: string;
  milestoneId: string;
  role: "client" | "freelancer";
  state: string;
  submission: Submission | null;
  latestRun: Run | null;
  hasReport: boolean;
}) {
  const { projectId, milestoneId, role, state, submission, latestRun, hasReport } = props;
  const running = latestRun !== null && (latestRun.status === "queued" || latestRun.status === "running");
  const canSubmit = role === "freelancer" && (state === "FUNDED" || state === "REPORT_READY");
  const reportHref = `/projects/${projectId}/milestones/${milestoneId}/report`;
  // Held here, not in SubmitForm: a failed start after a successful submit moves the milestone to SUBMITTED,
  // the form unmounts on refresh, and its error would vanish (live 8 Nov: the planner's error went unseen).
  const [startError, setStartError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Verification</p>
        {hasReport ? (
          <Button size="sm" variant="outline" render={<Link href={reportHref} />} nativeButton={false}>
            View report
          </Button>
        ) : null}
      </div>

      {submission ? (
        <p className="text-sm text-muted-foreground">
          Submitted <span className="font-mono text-xs">{submission.repoUrl.replace("https://github.com/", "")}</span> at{" "}
          <span className="font-mono text-xs">{submission.commitSha.slice(0, 12)}</span>, deployed at <span className="font-mono text-xs break-all">{submission.deployUrl}</span>
        </p>
      ) : null}

      {running ? <RunStatus run={latestRun} /> : null}
      {state === "SUBMITTED" && submission && !running ? (
        <StartRun
          projectId={projectId}
          submissionId={submission.id}
          lastError={latestRun?.status === "errored" ? latestRun.errorCode : null}
          runUrl={latestRun?.runUrl ?? null}
          error={startError}
          setError={setStartError}
        />
      ) : null}
      {canSubmit ? <SubmitForm projectId={projectId} milestoneId={milestoneId} resubmit={state === "REPORT_READY"} onStartError={setStartError} /> : null}
      {!submission && !canSubmit ? <p className="text-sm text-muted-foreground">Waiting for the freelancer to submit the work.</p> : null}
    </div>
  );
}

function RunStatus({ run }: { run: Run }) {
  const router = useRouter();
  const [s, setS] = useState<{ status: string; runUrl: string | null } | null>(null);
  const attempt = useRef(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/verification-runs/${run.id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as { status: string; runUrl: string | null };
          if (stopped) return;
          setS(next);
          if (next.status === "completed" || next.status === "errored") {
            router.refresh();
            return;
          }
        }
      } catch {
        // network blip or a cold start: keep polling
      }
      // Each poll also advances the run on the server (at most one GitHub call per 15 s).
      if (!stopped) timer = setTimeout(poll, Math.max(pollDelay(attempt.current++), 5000));
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run.id, router]);
  const runUrl = s?.runUrl ?? run.runUrl;
  return (
    <div className="flex items-start gap-3">
      <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
      <div className="flex flex-col gap-1 text-sm">
        <p role="status" aria-live="polite">
          {runUrl ? "Running the tests and browser checks on GitHub Actions. This usually takes 2 to 4 minutes." : "Starting the verification run on GitHub Actions…"}
        </p>
        {runUrl ? (
          <a href={runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Public run log <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function StartRun(props: {
  projectId: string;
  submissionId: string;
  lastError: string | null;
  runUrl: string | null;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const { projectId, submissionId, lastError, runUrl, error, setError } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      {lastError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone="fail">Run stopped</StatusBadge>
          <span>{errorText(lastError)}</span>
          {runUrl ? (
            <a href={runUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Run log
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The work is submitted. Start the verification run.</p>
      )}
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await startVerificationAction(projectId, submissionId);
              if (!r.ok) setError(r.error);
              router.refresh();
            })
          }
        >
          {pending ? "Planning the checks…" : lastError ? "Run verification again" : "Start verification"}
        </Button>
      </div>
      {error ? <FieldError>{errorText(error)}</FieldError> : null}
    </div>
  );
}

function SubmitForm({ projectId, milestoneId, resubmit, onStartError }: { projectId: string; milestoneId: string; resubmit: boolean; onStartError: (e: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = { repoUrl: String(fd.get("repoUrl") ?? "").trim(), commitSha: String(fd.get("commitSha") ?? "").trim(), deployUrl: String(fd.get("deployUrl") ?? "").trim() };
        start(async () => {
          setError(null);
          const sub = await submitWorkAction(projectId, milestoneId, input);
          if (!sub.ok) {
            setError(sub.error);
            return;
          }
          const run = await startVerificationAction(projectId, sub.value.submissionId);
          onStartError(run.ok ? null : run.error);
          router.refresh();
        });
      }}
    >
      <p className="text-sm font-medium">{resubmit ? "Submit a new version" : "Submit the work"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`repo-${milestoneId}`}>Public GitHub repository</Label>
          <Input id={`repo-${milestoneId}`} name="repoUrl" required placeholder="https://github.com/you/taskboard" autoComplete="off" spellCheck={false} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`sha-${milestoneId}`}>Commit SHA</Label>
          <Input id={`sha-${milestoneId}`} name="commitSha" required placeholder="40 characters, from git rev-parse HEAD" autoComplete="off" spellCheck={false} className="font-mono" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`url-${milestoneId}`}>Deployed site</Label>
          <Input id={`url-${milestoneId}`} name="deployUrl" required type="url" placeholder="https://taskboard.onrender.com" autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <FieldHint>
        Arbiter runs your tests and browser checks on a fresh GitHub Actions VM with no secrets. The run log and screenshots are public, and the VM has open internet access.
      </FieldHint>
      {error ? <FieldError>{errorText(error)}</FieldError> : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Submitting…" : resubmit ? "Resubmit and verify" : "Submit and verify"}
        </Button>
      </div>
    </form>
  );
}
