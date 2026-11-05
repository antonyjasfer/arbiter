// Hash-chained audit log, one chain per project. Each event's hash covers its content and the previous
// hash; the project row keeps the head (seq and hash), so edits, deletions, reordering and truncation
// are detectable. Limit: someone with write access to both the events and the project row could
// rewrite the whole chain; anchoring the head publicly is out of scope.
import { asc, eq } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@/lib/canonical-json";
import type { Db } from "../db/types";
import { auditEvents, projects } from "../db/schema";

export const AUDIT_ACTIONS = [
  "project_created",
  "invite_created",
  "invite_accepted",
  "compile_started",
  "compile_finished",
  "compile_failed",
  "version_created",
  "version_edited",
  "approved",
  "locked",
  "demo_reset",
  // Phase 4: verification.
  "submission_created",
  "resubmitted",
  "verification_started",
  "verification_finished",
  "verification_errored",
  "injection_flagged",
  // Phase 5: payments.
  "funding_started",
  "funded",
  "authorization_lost",
  "funding_voided",
  "release_approved",
  "override_recorded",
  "capture_pending",
  "capture_completed",
  "capture_denied",
  "payout_sent",
  "payout_succeeded",
  "payout_failed",
  "paypal_email_set",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type ChainCheck =
  | { ok: true; count: number }
  | { ok: false; seq: number; problem: "hash_mismatch" | "prev_mismatch" | "gap" | "head_mismatch" };

function eventHash(e: {
  projectId: string;
  seq: number;
  actorId: string | null;
  action: string;
  data: unknown;
  createdAt: Date;
  prevHash: string | null;
}): string {
  return sha256Hex(
    canonicalJson({
      projectId: e.projectId,
      seq: e.seq,
      actorId: e.actorId,
      action: e.action,
      data: e.data,
      createdAt: e.createdAt.toISOString(),
      prevHash: e.prevHash,
    }),
  );
}

/** Must run inside the caller's transaction, so the event commits or rolls back with the action. */
export async function appendAudit(
  tx: Db,
  e: { projectId: string; actorId: string | null; action: AuditAction; data: Record<string, unknown> },
): Promise<{ seq: number; hash: string }> {
  // Row lock: concurrent appends for one project queue here instead of forking the chain.
  const [head] = await tx
    .select({ seq: projects.auditSeq, hash: projects.auditHeadHash })
    .from(projects)
    .where(eq(projects.id, e.projectId))
    .for("update");
  if (!head) throw new Error("appendAudit: project not found");
  const seq = head.seq + 1;
  const createdAt = new Date();
  const hash = eventHash({ ...e, seq, createdAt, prevHash: head.hash });
  await tx.insert(auditEvents).values({ ...e, seq, createdAt, prevHash: head.hash, hash });
  await tx.update(projects).set({ auditSeq: seq, auditHeadHash: hash }).where(eq(projects.id, e.projectId));
  return { seq, hash };
}

export async function verifyChain(db: Db, projectId: string): Promise<ChainCheck> {
  const [head] = await db
    .select({ seq: projects.auditSeq, hash: projects.auditHeadHash })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!head) throw new Error("verifyChain: project not found");
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.projectId, projectId)).orderBy(asc(auditEvents.seq));
  let prev: string | null = null;
  for (const [i, row] of rows.entries()) {
    const expected = i + 1;
    if (row.seq !== expected) return { ok: false, seq: expected, problem: "gap" };
    if (row.prevHash !== prev) return { ok: false, seq: row.seq, problem: "prev_mismatch" };
    if (eventHash(row) !== row.hash) return { ok: false, seq: row.seq, problem: "hash_mismatch" };
    prev = row.hash;
  }
  if (head.seq !== rows.length || head.hash !== prev) return { ok: false, seq: head.seq, problem: "head_mismatch" };
  return { ok: true, count: rows.length };
}
