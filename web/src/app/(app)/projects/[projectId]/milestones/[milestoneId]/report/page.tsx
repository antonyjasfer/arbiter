import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ReportView } from "@/components/verification/report-view";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getReport } from "@/server/verification/report";

async function MilestoneReport({ params }: PageProps<"/projects/[projectId]/milestones/[milestoneId]/report">) {
  const { projectId, milestoneId } = await params;
  const user = await requireUser();
  if (!user.ok) redirect("/");
  const r = await getReport(getDb(), { userId: user.value.userId, milestoneId });
  // Members only; a milestone of another project (or across the demo boundary) is a 404, never a redirect.
  if (!r.ok || (r.value && r.value.projectId !== projectId)) notFound();
  const report = r.value;
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Project
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-balance">Verification report{report ? `: ${report.milestone.position}. ${report.milestone.title}` : ""}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Each verdict comes from the tests and browser checks Arbiter ran on a fresh GitHub Actions VM, linked to the public run log. The AI only plans the checks and
          explains the results; it cannot change a verdict or move money.
        </p>
      </header>
      {report ? <ReportView report={report} /> : <p className="text-sm text-muted-foreground">No completed verification run yet.</p>}
    </>
  );
}

export default function ReportPage(props: PageProps<"/projects/[projectId]/milestones/[milestoneId]/report">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading report" />}>
      <MilestoneReport {...props} />
    </Suspense>
  );
}
