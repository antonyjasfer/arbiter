// Agreement versions: drafts are JSON bodies on agreement_versions; both parties approve the exact hash
// they were shown; the second approval locks the version and creates the milestone rows (DRAFT -> AGREED).
// Every change runs in one transaction with its audit event, under a row lock on the agreement.
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@/lib/canonical-json";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import { requireProjectRole, type ProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { acceptanceCriteria, agreements, agreementVersions, milestones, projects } from "../db/schema";
import { transitionMilestone } from "../milestones/transition";
import { centsToMoney, moneyToCents } from "../projects/money";
import type { AgreementBody } from "./body";
import { checkBody, type CheckProblem } from "./compiler";
import { feeFor } from "./fees";

export type VersionError =
  | { code: "not_member" | "forbidden" | "stale" | "locked" | "no_version" }
  | { code: "invalid_body"; problems: CheckProblem[] };

export type CurrentVersion = {
  id: string;
  version: number;
  hash: string;
  body: AgreementBody;
  source: "ai" | "manual";
  clientApprovedAt: Date | null;
  freelancerApprovedAt: Date | null;
  locked: boolean;
  lockedAt: Date | null;
  fees: { key: string; feeCents: number; payoutCents: number }[];
};

export function versionHash(projectId: string, version: number, body: AgreementBody): string {
  return sha256Hex(canonicalJson({ projectId, version, body }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function lockAgreement(tx: Db, projectId: string) {
  const [a] = await tx.select().from(agreements).where(eq(agreements.projectId, projectId)).for("update");
  return a;
}

async function currentRow(tx: Db, agreementId: string) {
  const [v] = await tx.select().from(agreementVersions).where(eq(agreementVersions.agreementId, agreementId)).orderBy(desc(agreementVersions.version)).limit(1);
  return v;
}

class AgreementLocked extends Error {
  constructor() {
    super("agreement is locked");
    this.name = "AgreementLocked";
  }
}

/** Appends a new version (no approvals). Runs inside the caller's transaction; throws AgreementLocked. */
async function insertVersion(
  tx: Db,
  args: { projectId: string; userId: string; body: AgreementBody; jobId: string | null; source: "ai" | "manual" },
): Promise<{ version: number; hash: string }> {
  // The unique index on project_id makes concurrent first versions share one agreement: whoever loses the
  // insert waits on the winner's row lock below, then appends the next version.
  await tx.insert(agreements).values({ projectId: args.projectId, currentVersion: 0 }).onConflictDoNothing({ target: agreements.projectId });
  const a = await lockAgreement(tx, args.projectId);
  if (a!.status === "locked") throw new AgreementLocked();
  const [{ last } = { last: null }] = await tx.select({ last: max(agreementVersions.version) }).from(agreementVersions).where(eq(agreementVersions.agreementId, a!.id));
  const version = (last ?? 0) + 1;
  const hash = versionHash(args.projectId, version, args.body);
  await tx.insert(agreementVersions).values({ agreementId: a!.id, version, bodyJson: args.body, hash, source: args.source, createdBy: args.userId, compileJobId: args.jobId });
  await tx.update(agreements).set({ currentVersion: version }).where(eq(agreements.id, a!.id));
  await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "version_created", data: { version, hash, source: args.source } });
  return { version, hash };
}

/** Called by the compile job inside its transaction, with a body that already passed the checks. */
export async function applyCompileResult(
  tx: Db,
  args: { projectId: string; userId: string; body: AgreementBody; jobId: string | null },
): Promise<{ version: number; hash: string }> {
  return insertVersion(tx, { ...args, source: "ai" });
}

/** The client writes the next version by hand: after a failed compile, past a daily cap, or from scratch. */
export async function createManualVersion(
  db: Db,
  args: { userId: string; projectId: string; body: AgreementBody },
): Promise<Result<{ version: number; hash: string }, VersionError>> {
  const role = await requireProjectRole(db, { userId: args.userId, projectId: args.projectId, allowed: ["client"] });
  if (!role.ok) return { ok: false, error: { code: role.error } };
  const [p] = await db.select({ budget: projects.budget }).from(projects).where(eq(projects.id, args.projectId));
  const checked = checkBody(args.body, moneyToCents(p!.budget));
  if (!checked.ok) return { ok: false, error: { code: "invalid_body", problems: checked.error } };
  const body = checked.value;
  try {
    const v = await db.transaction((tx) => insertVersion(tx, { projectId: args.projectId, userId: args.userId, body, jobId: null, source: "manual" }));
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof AgreementLocked) return { ok: false, error: { code: "locked" } };
    throw e;
  }
}

export async function getCurrentVersion(db: Db, args: { userId: string; projectId: string }): Promise<Result<CurrentVersion | null, VersionError>> {
  const role = await requireProjectRole(db, { ...args, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: { code: role.error } };
  const [a] = await db.select().from(agreements).where(eq(agreements.projectId, args.projectId));
  if (!a) return { ok: true, value: null };
  const v = await currentRow(db, a.id);
  if (!v) return { ok: true, value: null };
  const body = v.bodyJson as AgreementBody;
  return {
    ok: true,
    value: {
      id: v.id,
      version: v.version,
      hash: v.hash,
      body,
      source: v.source,
      clientApprovedAt: v.clientApprovedAt,
      freelancerApprovedAt: v.freelancerApprovedAt,
      locked: v.lockedAt !== null,
      lockedAt: v.lockedAt,
      fees: body.milestones.map((m) => ({ key: m.key, ...feeFor(m.amountCents) })),
    },
  };
}

export async function saveEdit(
  db: Db,
  args: { userId: string; projectId: string; expectedHash: string; body: AgreementBody },
): Promise<Result<{ version: number; hash: string }, VersionError>> {
  const role = await requireProjectRole(db, { userId: args.userId, projectId: args.projectId, allowed: ["client"] });
  if (!role.ok) return { ok: false, error: { code: role.error } };
  const [p] = await db.select({ budget: projects.budget }).from(projects).where(eq(projects.id, args.projectId));
  const checked = checkBody(args.body, moneyToCents(p!.budget));
  if (!checked.ok) return { ok: false, error: { code: "invalid_body", problems: checked.error } };
  const body = checked.value;
  return db.transaction(async (tx) => {
    const a = await lockAgreement(tx, args.projectId);
    if (!a) return { ok: false, error: { code: "no_version" } } as const;
    if (a.status === "locked") return { ok: false, error: { code: "locked" } } as const;
    const v = await currentRow(tx, a.id);
    if (!v) return { ok: false, error: { code: "no_version" } } as const;
    if (v.hash !== args.expectedHash) return { ok: false, error: { code: "stale" } } as const;
    const approved = Boolean(v.clientApprovedAt || v.freelancerApprovedAt);
    // In place only for an unapproved hand-written version. The AI's draft is never rewritten, so its
    // provenance stays visible: editing it, or anything already approved, makes a new version.
    if (!approved && v.source === "manual") {
      const hash = versionHash(args.projectId, v.version, body);
      const [done] = await tx
        .update(agreementVersions)
        .set({ bodyJson: body, hash, source: "manual" })
        .where(and(eq(agreementVersions.id, v.id), eq(agreementVersions.hash, args.expectedHash), isNull(agreementVersions.clientApprovedAt), isNull(agreementVersions.freelancerApprovedAt)))
        .returning({ id: agreementVersions.id });
      if (!done) return { ok: false, error: { code: "stale" } } as const;
      await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "version_edited", data: { version: v.version, hash } });
      return { ok: true, value: { version: v.version, hash } } as const;
    }
    // A new version that nobody has approved yet.
    const version = v.version + 1;
    const hash = versionHash(args.projectId, version, body);
    await tx.insert(agreementVersions).values({ agreementId: a.id, version, bodyJson: body, hash, source: "manual", createdBy: args.userId });
    await tx.update(agreements).set({ currentVersion: version }).where(eq(agreements.id, a.id));
    await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "version_created", data: { version, hash, source: "manual", clearedApprovals: approved } });
    return { ok: true, value: { version, hash } } as const;
  });
}

export async function approve(
  db: Db,
  args: { userId: string; projectId: string; expectedHash: string },
): Promise<Result<{ locked: boolean }, VersionError>> {
  if (!parseId(args.projectId)) return { ok: false, error: { code: "not_member" } };
  const role = await requireProjectRole(db, { userId: args.userId, projectId: args.projectId, allowed: ["client", "freelancer"] });
  if (!role.ok) return { ok: false, error: { code: role.error } };
  const who: ProjectRole = role.value.role;
  return db.transaction(async (tx) => {
    const a = await lockAgreement(tx, args.projectId);
    if (!a) return { ok: false, error: { code: "no_version" } } as const;
    if (a.status === "locked") return { ok: false, error: { code: "locked" } } as const;
    const v = await currentRow(tx, a.id);
    if (!v) return { ok: false, error: { code: "no_version" } } as const;
    if (v.hash !== args.expectedHash) return { ok: false, error: { code: "stale" } } as const;
    const mine = who === "client" ? v.clientApprovedAt : v.freelancerApprovedAt;
    if (mine) return { ok: true, value: { locked: false } } as const;

    const now = new Date();
    const column = who === "client" ? agreementVersions.clientApprovedAt : agreementVersions.freelancerApprovedAt;
    const [done] = await tx
      .update(agreementVersions)
      .set(who === "client" ? { clientApprovedAt: now } : { freelancerApprovedAt: now })
      .where(and(eq(agreementVersions.id, v.id), eq(agreementVersions.hash, args.expectedHash), isNull(column), isNull(agreementVersions.lockedAt)))
      .returning();
    if (!done) return { ok: false, error: { code: "stale" } } as const;
    await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "approved", data: { role: who, version: v.version, hash: v.hash } });
    if (!done.clientApprovedAt || !done.freelancerApprovedAt) return { ok: true, value: { locked: false } } as const;

    // Both parties approved this exact hash: lock it and create the milestones.
    await tx.update(agreementVersions).set({ lockedAt: now }).where(eq(agreementVersions.id, v.id));
    await tx.update(agreements).set({ status: "locked" }).where(eq(agreements.id, a.id));
    const body = v.bodyJson as AgreementBody;
    for (const [i, m] of body.milestones.entries()) {
      const [row] = await tx
        .insert(milestones)
        .values({ agreementVersionId: v.id, position: i + 1, title: m.title, amount: centsToMoney(m.amountCents), dueAt: new Date(now.getTime() + m.dueInDays * DAY_MS) })
        .returning({ id: milestones.id });
      await tx.insert(acceptanceCriteria).values(
        m.criteria.map((c) => ({ milestoneId: row!.id, kind: c.kind, text: c.text, specJson: { key: c.key, needsHumanJudgment: c.needsHumanJudgment } })),
      );
      const moved = await transitionMilestone(tx, { milestoneId: row!.id, expectedState: "DRAFT", expectedVersion: 0, event: "both_approved" });
      if (!moved.ok) throw new Error(`approve: milestone ${m.key} did not move to AGREED (${moved.error})`);
    }
    await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "locked", data: { version: v.version, hash: v.hash, milestones: body.milestones.length } });
    return { ok: true, value: { locked: true } } as const;
  });
}
