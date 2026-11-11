import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCents } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { keptDemoProjectIds } from "@/server/demo/seed";
import { listProjectsWithStatus } from "@/server/projects/workspace";
import { ResetDemoButton } from "./reset-demo-button";

type ProjectRow = Awaited<ReturnType<typeof listProjectsWithStatus>>[number];

function ProjectList({ projects }: { projects: ProjectRow[] }) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}`} className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{p.title}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatCents(p.budgetCents)} · you are the {p.role}
              </span>
            </div>
            <StatusBadge tone={p.badge.tone}>{p.badge.label}</StatusBadge>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Projects() {
  const user = await requireUser();
  if (!user.ok) redirect("/");
  const db = getDb();
  const [me] = await db.select({ isDemo: users.isDemo, name: users.name }).from(users).where(eq(users.id, user.value.userId));
  const all = await listProjectsWithStatus(db, user.value.userId);
  // Demo projects that Reset demo keeps (a live PayPal payment) get their own section below the fresh ones.
  const kept = me?.isDemo ? await keptDemoProjectIds(db) : new Set<string>();
  const projects = all.filter((p) => !kept.has(p.id));
  const keptProjects = all.filter((p) => kept.has(p.id));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Projects</h1>
          {me?.isDemo ? <p className="text-sm text-muted-foreground">You&apos;re signed in as {me.name}. Demo data only.</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {me?.isDemo ? <ResetDemoButton /> : null}
          <Button render={<Link href="/projects/new" />} nativeButton={false}>
            <Plus aria-hidden /> New project
          </Button>
        </div>
      </div>
      {projects.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-xl border border-dashed p-8 text-center">
          <p className="font-semibold">No projects yet</p>
          <p className="text-sm text-muted-foreground">Create one as the client, or open the invite link your client sent you.</p>
        </div>
      ) : (
        <ProjectList projects={projects} />
      )}
      {keptProjects.length > 0 ? (
        <section aria-labelledby="kept-heading" className="flex flex-col gap-2">
          <h2 id="kept-heading" className="text-base font-semibold">
            Kept: has a live PayPal payment
          </h2>
          <p className="text-sm text-muted-foreground">Reset demo keeps these projects, because real sandbox money was authorized, captured or paid out in them.</p>
          <ProjectList projects={keptProjects} />
        </section>
      ) : null}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-label="Loading projects" />}>
      <Projects />
    </Suspense>
  );
}
