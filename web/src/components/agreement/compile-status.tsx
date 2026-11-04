"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { retryNowAction } from "@/app/(app)/projects/actions";
import { Button } from "@/components/ui/button";
import { pollDelay } from "@/lib/format";

type Status = { status: "queued" | "running" | "succeeded" | "failed"; errorCode: string | null; nextAttemptAt: string; attempts: number };

const timeIst = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit" });

// Polls the job until it ends, then refreshes the page so the server renders the result.
export function CompileStatus({ jobId, isClient }: { jobId: string; isClient: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [pending, start] = useTransition();
  const attempt = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/compile-jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (stopped) return;
          setS(next);
          if (next.status === "succeeded" || next.status === "failed") {
            router.refresh();
            return;
          }
        }
      } catch {
        // network blip or cold start: keep polling
      }
      if (!stopped) timer = setTimeout(poll, pollDelay(attempt.current++));
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, router]);

  const busy = s?.status === "queued" && s.errorCode === "ai_busy";
  const message = !s
    ? "Checking the AI draft…"
    : busy
      ? `The AI is busy. Retrying at ${timeIst.format(new Date(s.nextAttemptAt))} IST (attempt ${s.attempts + 1} of 4).`
      : s.status === "queued"
        ? "Queued. The AI will start drafting in a moment."
        : s.status === "running"
          ? "Drafting milestones and acceptance criteria. This can take up to 30 seconds."
          : "Done. Loading the agreement…";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/30 p-6">
      <div className="flex items-start gap-3">
        <LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Drafting the agreement</p>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {message}
          </p>
        </div>
      </div>
      <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="Steps">
        {["The AI proposes milestones", "Arbiter checks the amounts and rules", "You review, edit and approve"].map((step, i) => (
          <li key={step} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-muted font-mono text-xs">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      {busy && isClient ? (
        <div>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => void (await retryNowAction(jobId)))}>
            Retry now
          </Button>
        </div>
      ) : null}
    </div>
  );
}
