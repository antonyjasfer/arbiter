import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AuditTimeline } from "@/components/audit/timeline";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getAuditTrail } from "@/server/projects/workspace";

async function Audit({ params }: PageProps<"/projects/[projectId]/audit">) {
  const { projectId } = await params;
  const user = await requireUser();
  if (!user.ok) redirect("/");
  const r = await getAuditTrail(getDb(), { userId: user.value.userId, projectId });
  if (!r.ok) notFound();
  const { title, chain, events } = r.value;
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {title}
        </Link>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every action on this project, in order. Each entry&apos;s SHA-256 hash covers its content and the previous entry&apos;s hash, so an edited, deleted or reordered entry
            breaks the chain.
          </p>
        </div>
        {chain.ok ? (
          <StatusBadge tone="pass">Chain verified ✓ · {chain.count} events</StatusBadge>
        ) : (
          <StatusBadge tone="fail">Chain broken at event {chain.seq}</StatusBadge>
        )}
      </header>
      <AuditTimeline events={events} />
      <p className="text-xs text-muted-foreground">
        Limit: this detects tampering by anyone who cannot rewrite both the events and the project&apos;s stored head hash. Someone with full database access could rewrite the
        whole chain.
      </p>
    </>
  );
}

export default function AuditPage(props: PageProps<"/projects/[projectId]/audit">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading audit log" />}>
      <Audit {...props} />
    </Suspense>
  );
}
