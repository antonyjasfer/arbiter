import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { History, ShieldAlert } from "lucide-react";
import { AgreementWorkspace } from "@/components/agreement/agreement-workspace";
import { InviteCard } from "@/components/agreement/invite-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCents } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getLockedMilestones, getWorkspace } from "@/server/projects/workspace";
import { LockedMilestones } from "@/components/agreement/locked-milestones";

const START_ERRORS = new Set(["daily_cap", "demo_cap", "job_running", "locked"]);

async function ProjectWorkspace({ params, searchParams }: PageProps<"/projects/[projectId]">) {
  const [{ projectId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  if (!user.ok) redirect("/");
  const r = await getWorkspace(getDb(), { userId: user.value.userId, projectId });
  if (!r.ok) notFound();
  const ws = r.value;
  const locked = await getLockedMilestones(getDb(), { userId: user.value.userId, projectId });
  const startError = typeof sp.compile === "string" && START_ERRORS.has(sp.compile) && !ws.version ? sp.compile : null;
  const flagged = ws.project.briefFlags.includes("ai_instructions");

  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Projects
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold text-balance">{ws.project.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">Budget {formatCents(ws.project.budgetCents)}</span>
            <span aria-hidden>·</span>
            <span>You are the {ws.role}</span>
            {ws.project.isDemo ? <StatusBadge tone="pending">Demo</StatusBadge> : null}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/projects/${ws.project.id}/audit`} />} nativeButton={false}>
          <History aria-hidden /> Audit log
        </Button>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <section aria-labelledby="brief-title" className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-5">
            <h2 id="brief-title" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Client&apos;s brief
            </h2>
            {flagged ? (
              <p className="flex gap-2 rounded-lg border border-status-review/40 bg-status-review/10 p-3 text-sm">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  This brief contains text aimed at an AI (for example &ldquo;ignore previous instructions&rdquo;). Arbiter treats it only as a description of the work, and the
                  amounts are still checked against the budget.
                </span>
              </p>
            ) : null}
            <p className="max-h-[28rem] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-pretty">{ws.project.brief}</p>
          </section>
          <section aria-labelledby="parties-title" className="flex flex-col gap-2 rounded-xl border p-5 text-sm">
            <h2 id="parties-title" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Parties
            </h2>
            <p>
              <span className="text-muted-foreground">Client:</span> {ws.parties.client}
            </p>
            <p>
              <span className="text-muted-foreground">Freelancer:</span> {ws.parties.freelancer ?? "not joined yet"}
            </p>
          </section>
          {ws.role === "client" && !ws.parties.freelancer ? <InviteCard projectId={ws.project.id} hasOpenInvite={ws.hasOpenInvite} /> : null}
        </aside>
        <section aria-label="Agreement">
          <div className="flex flex-col gap-6">
            <AgreementWorkspace ws={ws} failedDraft={ws.draft} startError={startError} />
            <LockedMilestones projectId={ws.project.id} milestones={locked.ok ? locked.value : []} role={ws.role} />
          </div>
        </section>
      </div>
    </>
  );
}

export default function ProjectPage(props: PageProps<"/projects/[projectId]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading project" />}>
      <ProjectWorkspace {...props} />
    </Suspense>
  );
}
