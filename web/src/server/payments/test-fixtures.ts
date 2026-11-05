// Tests only: a project with a client, a freelancer (with a sandbox PayPal email) and a locked agreement
// whose milestones are AGREED, built through the real Phase 2/3 functions.
import { eq } from "drizzle-orm";
import { applyCompileResult, approve, getCurrentVersion } from "../agreements/versions";
import { checkCompilerOutput } from "../agreements/compiler";
import type { Db } from "../db/types";
import * as s from "../db/schema";
import { acceptInvite, createInvite } from "../projects/invitations";
import { createProject } from "../projects/projects";

export const FREELANCER_EMAIL = "freelancer@example.test";

export type Fixture = { client: string; freelancer: string; outsider: string; projectId: string; milestoneIds: string[] };

export async function lockedProject(db: Db, opts: { freelancerEmail?: string | null; amountsCents?: number[] } = {}): Promise<Fixture> {
  const email = opts.freelancerEmail === undefined ? FREELANCER_EMAIL : opts.freelancerEmail;
  const users = await db
    .insert(s.users)
    .values([
      { githubId: "c1", login: "client" },
      { githubId: "f1", login: "freelancer", paypalEmail: email },
      { githubId: "o1", login: "outsider" },
    ])
    .returning();
  const [client, freelancer, outsider] = users.map((u) => u.id) as [string, string, string];
  const amounts = opts.amountsCents ?? [5000, 10000];
  const budget = amounts.reduce((a, b) => a + b, 0);
  const p = await createProject(db, { userId: client, title: "TaskBoard", brief: "A small task-list web app with add, complete and filter.", budgetCents: budget });
  if (!p.ok) throw new Error("fixture: project");
  const projectId = p.value.projectId;
  const inv = await createInvite(db, { userId: client, projectId });
  if (!inv.ok) throw new Error("fixture: invite");
  await acceptInvite(db, { userId: freelancer, token: inv.value.token });
  const body = checkCompilerOutput(
    {
      milestones: amounts.map((amount_cents, i) => ({
        title: `Milestone ${i + 1}`,
        amount_cents,
        due_in_days: 7 * (i + 1),
        criteria: [{ kind: "test" as const, text: "npm test passes." }],
      })),
      questions: [],
    },
    budget,
  );
  if (!body.ok) throw new Error("fixture: body");
  await db.transaction((tx) => applyCompileResult(tx, { projectId, userId: client, body: body.value, jobId: null }));
  const v = await getCurrentVersion(db, { userId: client, projectId });
  if (!v.ok || !v.value) throw new Error("fixture: version");
  for (const userId of [client, freelancer]) {
    const r = await approve(db, { userId, projectId, expectedHash: v.value.hash });
    if (!r.ok) throw new Error("fixture: approve");
  }
  const ms = await db.select({ id: s.milestones.id, position: s.milestones.position }).from(s.milestones).orderBy(s.milestones.position);
  return { client, freelancer, outsider, projectId, milestoneIds: ms.map((m) => m.id) };
}

export async function milestoneRow(db: Db, id: string) {
  const [m] = await db.select().from(s.milestones).where(eq(s.milestones.id, id));
  if (!m) throw new Error("fixture: milestone");
  return m;
}

export async function paymentRows(db: Db, milestoneId: string) {
  return db.select().from(s.payments).where(eq(s.payments.milestoneId, milestoneId)).orderBy(s.payments.createdAt);
}

export async function auditActions(db: Db, projectId: string): Promise<string[]> {
  const rows = await db.select({ action: s.auditEvents.action, seq: s.auditEvents.seq }).from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId)).orderBy(s.auditEvents.seq);
  return rows.map((r) => r.action);
}
