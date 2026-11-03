// Single-use freelancer invites. No email (zero budget): the client copies the link. Only the token's
// SHA-256 is stored, so a database reader cannot use an invite.
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sha256Hex } from "@/lib/canonical-json";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import { requireProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { invitations, projectMembers, projects, users } from "../db/schema";

const INVITE_DAYS = 7;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function createInvite(
  db: Db,
  args: { userId: string; projectId: string; now?: Date },
): Promise<Result<{ token: string; expiresAt: Date }, "not_member" | "forbidden" | "has_freelancer">> {
  const role = await requireProjectRole(db, { userId: args.userId, projectId: args.projectId, allowed: ["client"] });
  if (!role.ok) return role;
  const now = args.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const [freelancer] = await tx
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, args.projectId), eq(projectMembers.role, "freelancer")));
    if (freelancer) return { ok: false, error: "has_freelancer" } as const;
    // One live link per project: a new invite replaces any unused one.
    await tx.delete(invitations).where(and(eq(invitations.projectId, args.projectId), isNull(invitations.acceptedAt)));
    await tx.insert(invitations).values({ projectId: args.projectId, role: "freelancer", tokenHash: sha256Hex(token), expiresAt });
    await appendAudit(tx, { projectId: args.projectId, actorId: args.userId, action: "invite_created", data: { expiresAt: expiresAt.toISOString() } });
    return { ok: true, value: { token, expiresAt } } as const;
  });
}

/** Resolves an invite for display, without consuming it. Same "invalid" for every reason, so it leaks nothing. */
export async function peekInvite(db: Db, args: { userId: string; token: string; now?: Date }): Promise<Result<{ projectId: string; title: string }, "invalid">> {
  if (!TOKEN_RE.test(args.token)) return { ok: false, error: "invalid" };
  const now = args.now ?? new Date();
  const [row] = await db
    .select({ projectId: projects.id, title: projects.title, projectDemo: projects.isDemo, userDemo: users.isDemo })
    .from(invitations)
    .innerJoin(projects, eq(projects.id, invitations.projectId))
    .innerJoin(users, eq(users.id, args.userId))
    .where(and(eq(invitations.tokenHash, sha256Hex(args.token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)));
  if (!row || row.projectDemo !== row.userDemo) return { ok: false, error: "invalid" };
  return { ok: true, value: { projectId: row.projectId, title: row.title } };
}

export async function acceptInvite(
  db: Db,
  args: { userId: string; token: string; now?: Date },
): Promise<Result<{ projectId: string }, "invalid" | "own_project" | "has_freelancer">> {
  const peek = await peekInvite(db, args);
  if (!peek.ok) return peek;
  const { projectId } = peek.value;
  const now = args.now ?? new Date();
  return db.transaction(async (tx) => {
    const members = await tx.select({ userId: projectMembers.userId, role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (members.some((m) => m.userId === args.userId)) return { ok: false, error: "own_project" } as const;
    if (members.some((m) => m.role === "freelancer")) return { ok: false, error: "has_freelancer" } as const;
    // Guarded consume: of two concurrent accepts, only one update matches.
    const [used] = await tx
      .update(invitations)
      .set({ acceptedAt: now, acceptedBy: args.userId })
      .where(and(eq(invitations.tokenHash, sha256Hex(args.token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)))
      .returning({ id: invitations.id });
    if (!used) return { ok: false, error: "invalid" } as const;
    await tx.insert(projectMembers).values({ projectId, userId: args.userId, role: "freelancer" });
    await appendAudit(tx, { projectId, actorId: args.userId, action: "invite_accepted", data: {} });
    return { ok: true, value: { projectId } } as const;
  });
}
