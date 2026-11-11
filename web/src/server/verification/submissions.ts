// Freelancer submissions: a public GitHub repo at a pinned commit plus a deployed https URL, for a FUNDED
// milestone (or a REPORT_READY one, as a resubmission). Inputs are checked with the same patterns as the
// arbiter-runner `validate` job, and the deploy host must not be private, loopback or link-local.
// Limit: hosts are checked by name only (no DNS lookup), so a public name that resolves to a private
// address is not caught here; the browser checks run on a GitHub VM that holds no secrets.
import { and, eq, isNull } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { appendAudit } from "../audit/audit";
import { requireProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { agreements, agreementVersions, milestones, submissions } from "../db/schema";
import { transitionMilestone } from "../milestones/transition";

// The SAME patterns as arbiter-runner .github/workflows/verify.yml (job validate).
export const REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export const SHA_RE = /^[0-9a-f]{40}$/;
export const DEPLOY_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[!-~]*)?$/;

export type SubmitError = "not_found" | "forbidden" | "wrong_state" | "conflict" | "invalid_repo_url" | "invalid_sha" | "invalid_deploy_url";

/** `https://github.com/<owner>/<repo>` (an optional `.git` is dropped), or null. */
export function checkRepoUrl(raw: string): { url: string; owner: string; repo: string } | null {
  const url = raw.endsWith(".git") ? raw.slice(0, -4) : raw;
  if (!REPO_URL_RE.test(url)) return null;
  const [owner, repo] = url.slice("https://github.com/".length).split("/") as [string, string];
  if ([owner, repo].some((p) => p === "." || p === "..")) return null;
  return { url, owner, repo };
}

export function checkSha(raw: string): string | null {
  const sha = raw.toLowerCase();
  return SHA_RE.test(sha) ? sha : null;
}

const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** An https URL on a public host name, or null. IP literals, single-label and private names are refused. */
export function checkDeployUrl(raw: string): string | null {
  if (!DEPLOY_URL_RE.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return null; // any IP literal (WHATWG turns 2130706433 into 127.0.0.1)
  if (!host.includes(".") || host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return null;
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;
  return raw;
}

/** The project a milestone belongs to, or null. */
export async function milestoneProject(db: Db, milestoneId: string): Promise<{ projectId: string; state: string; stateVersion: number } | null> {
  if (!parseId(milestoneId)) return null;
  const [row] = await db
    .select({ projectId: agreements.projectId, state: milestones.state, stateVersion: milestones.stateVersion })
    .from(milestones)
    .innerJoin(agreementVersions, eq(agreementVersions.id, milestones.agreementVersionId))
    .innerJoin(agreements, eq(agreements.id, agreementVersions.agreementId))
    .where(eq(milestones.id, milestoneId));
  return row ?? null;
}

export async function submitWork(
  db: Db,
  args: { userId: string; milestoneId: string; repoUrl: string; commitSha: string; deployUrl: string },
): Promise<Result<{ submissionId: string }, SubmitError>> {
  const m = await milestoneProject(db, args.milestoneId);
  if (!m) return { ok: false, error: "not_found" };
  const role = await requireProjectRole(db, { userId: args.userId, projectId: m.projectId, allowed: ["freelancer"] });
  if (!role.ok) return { ok: false, error: role.error === "forbidden" ? "forbidden" : "not_found" };

  const repo = checkRepoUrl(args.repoUrl);
  if (!repo) return { ok: false, error: "invalid_repo_url" };
  const sha = checkSha(args.commitSha);
  if (!sha) return { ok: false, error: "invalid_sha" };
  const deployUrl = checkDeployUrl(args.deployUrl);
  if (!deployUrl) return { ok: false, error: "invalid_deploy_url" };

  const event = m.state === "FUNDED" ? "submit" : m.state === "REPORT_READY" ? "resubmit" : null;
  if (!event) return { ok: false, error: "wrong_state" };

  return db.transaction(async (tx) => {
    // Guarded: only succeeds if nobody moved the milestone since it was read above.
    const moved = await transitionMilestone(tx, { milestoneId: args.milestoneId, expectedState: m.state as "FUNDED" | "REPORT_READY", expectedVersion: m.stateVersion, event });
    if (!moved.ok) return { ok: false, error: moved.error === "conflict" ? "conflict" : "wrong_state" } as const;
    const now = new Date();
    await tx.update(submissions).set({ supersededAt: now }).where(and(eq(submissions.milestoneId, args.milestoneId), isNull(submissions.supersededAt)));
    const [sub] = await tx
      .insert(submissions)
      .values({ milestoneId: args.milestoneId, repoUrl: repo.url, commitSha: sha, deployUrl, submittedBy: args.userId })
      .returning({ id: submissions.id });
    await appendAudit(tx, {
      projectId: m.projectId,
      actorId: args.userId,
      action: event === "submit" ? "submission_created" : "resubmitted",
      data: { milestoneId: args.milestoneId, submissionId: sub!.id, repoUrl: repo.url, commitSha: sha, deployUrl },
    });
    return { ok: true, value: { submissionId: sub!.id } } as const;
  });
}
