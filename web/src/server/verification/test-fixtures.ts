// Tests only: a project with a locked agreement, so verification tests start from real AGREED milestones.
// FUNDED is reached with transitionMilestone directly (the plan allows this in tests; there is no
// production shortcut to FUNDED).
import { asc, eq } from "drizzle-orm";
import * as s from "../db/schema";
import type { Db } from "../db/types";
import { approve, createManualVersion, getCurrentVersion } from "../agreements/versions";
import { acceptInvite, createInvite } from "../projects/invitations";
import { createProject } from "../projects/projects";
import { transitionMilestone } from "../milestones/transition";
import type { CriterionKind } from "../agreements/body";

export const DEFAULT_CRITERIA: { kind: CriterionKind; text: string }[] = [
  { kind: "browser", text: "Adding a task called Buy milk shows it in the list." },
  { kind: "browser", text: "Ticking a task marks it done." },
  { kind: "test", text: "The repo's test suite passes." },
  { kind: "review", text: "The layout is easy to use." },
];

export type Fixture = {
  client: string;
  freelancer: string;
  outsider: string;
  projectId: string;
  milestoneId: string;
  criteria: { id: string; key: string; kind: CriterionKind; text: string }[];
};

export async function lockedProject(
  db: Db,
  opts: { criteria?: { kind: CriterionKind; text: string }[]; demo?: boolean; tag?: string } = {},
): Promise<Fixture> {
  const tag = opts.tag ?? "";
  const demo = opts.demo ?? false;
  const users = await db
    .insert(s.users)
    .values([
      { githubId: `${demo ? "demo:" : ""}c${tag}`, login: `client${tag}`, isDemo: demo },
      { githubId: `${demo ? "demo:" : ""}f${tag}`, login: `freelancer${tag}`, isDemo: demo },
      { githubId: `${demo ? "demo:" : ""}o${tag}`, login: `outsider${tag}`, isDemo: demo },
    ])
    .returning();
  const [client, freelancer, outsider] = users.map((u) => u.id) as [string, string, string];
  const p = await createProject(db, { userId: client, title: "TaskBoard", brief: "A small task-list web app with add, complete and a health check.", budgetCents: 30000 });
  if (!p.ok) throw new Error("fixture: project");
  const projectId = p.value.projectId;
  const inv = await createInvite(db, { userId: client, projectId });
  if (!inv.ok) throw new Error("fixture: invite");
  await acceptInvite(db, { userId: freelancer, token: inv.value.token });
  const v = await createManualVersion(db, {
    userId: client,
    projectId,
    body: {
      milestones: [
        { title: "Working app", amountCents: 15000, dueInDays: 7, criteria: opts.criteria ?? DEFAULT_CRITERIA },
        { title: "Filters", amountCents: 15000, dueInDays: 14, criteria: [{ kind: "static", text: "README explains how to run it." }] },
      ],
      questions: [],
    },
  });
  if (!v.ok) throw new Error(`fixture: version ${JSON.stringify(v.error)}`);
  await approve(db, { userId: client, projectId, expectedHash: v.value.hash });
  await approve(db, { userId: freelancer, projectId, expectedHash: v.value.hash });
  const cur = await getCurrentVersion(db, { userId: client, projectId });
  if (!cur.ok || !cur.value) throw new Error("fixture: current");
  const [m] = await db.select().from(s.milestones).where(eq(s.milestones.agreementVersionId, cur.value.id)).orderBy(asc(s.milestones.position));
  const rows = await db.select().from(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.milestoneId, m!.id));
  const criteria = rows
    .map((r) => ({ id: r.id, key: (r.specJson as { key: string }).key, kind: r.kind, text: r.text }))
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  return { client, freelancer, outsider, projectId, milestoneId: m!.id, criteria };
}

/** AGREED -> FUNDED, as Phase 5's authorization would do. Tests only. */
export async function fund(db: Db, milestoneId: string): Promise<void> {
  const [m] = await db.select().from(s.milestones).where(eq(s.milestones.id, milestoneId));
  const r = await transitionMilestone(db, { milestoneId, expectedState: m!.state, expectedVersion: m!.stateVersion, event: "authorized" });
  if (!r.ok) throw new Error(`fixture: fund ${r.error}`);
}
