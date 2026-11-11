// Evidence: the public run link, the trusted results.json and the browser screenshots, stored in
// evidence.content with their SHA-256 and served by Arbiter to project members only. Screenshots are public
// on GitHub already (the artifact), but Arbiter serves its own copy so the report keeps working after the
// artifact expires (7 days). Caps: 300 KB per screenshot, 20 per run; anything else is recorded as skipped.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { parseId } from "@/lib/ids";
import type { Result } from "@/lib/result";
import { requireProjectRole } from "../auth/roles";
import type { Db } from "../db/types";
import { evidence, submissions, verificationRuns } from "../db/schema";
import { RESULTS_FILE, type Results } from "./plan-dsl";
import { milestoneProject } from "./submissions";

export const MAX_SHOT_BYTES = 300 * 1024;
export const MAX_SHOTS = 20;
const SERVABLE = new Set(["image/jpeg", "application/json"]);

type Row = typeof evidence.$inferInsert;
export type Skipped = { path: string; reason: "too_large" | "over_limit" | "not_jpeg" | "missing" };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const isJpeg = (b: Uint8Array) => b.byteLength >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const LABEL: Record<Skipped["reason"], string> = {
  too_large: "Screenshot not stored: over 300 KB",
  over_limit: "Screenshot not stored: over 20 per run",
  not_jpeg: "Screenshot not stored: not a JPEG image",
  missing: "Screenshot not stored: missing from the results artifact",
};

/** Pure: the evidence rows for one run. Skipped screenshots are kept as content-less rows so the report can say so. */
export function planEvidence(args: {
  runId: string;
  runUrl: string | null;
  files: Record<string, Uint8Array>;
  results: Results | null;
  checkResultIdByKey: Record<string, string>;
}): { rows: Row[]; skipped: Skipped[] } {
  const rows: Row[] = [];
  const skipped: Skipped[] = [];
  if (args.runUrl) rows.push({ runId: args.runId, checkResultId: null, type: "run_link", label: "Public run log on GitHub", uri: args.runUrl, sha256: sha256(new TextEncoder().encode(args.runUrl)), content: null });
  const rj = args.files[RESULTS_FILE];
  if (rj && args.results) rows.push({ runId: args.runId, checkResultId: null, type: "results", label: RESULTS_FILE, uri: `artifact:${RESULTS_FILE}`, sha256: sha256(rj), content: Buffer.from(rj), contentType: "application/json", byteSize: rj.byteLength });

  let stored = 0;
  for (const [key, c] of Object.entries(args.results?.criteria ?? {})) {
    const checkResultId = args.checkResultIdByKey[key];
    if (!checkResultId) continue;
    for (const step of c.steps) {
      if (!step.screenshot) continue;
      const path = step.screenshot;
      const bytes = Object.hasOwn(args.files, path) ? args.files[path]! : null;
      const reason: Skipped["reason"] | null = !bytes ? "missing" : !isJpeg(bytes) ? "not_jpeg" : bytes.byteLength > MAX_SHOT_BYTES ? "too_large" : stored >= MAX_SHOTS ? "over_limit" : null;
      const base = { runId: args.runId, checkResultId, type: "screenshot" as const, uri: `artifact:${path}` };
      if (reason) {
        skipped.push({ path, reason });
        rows.push({ ...base, label: `Step ${step.index + 1}: ${LABEL[reason]}`, sha256: bytes ? sha256(bytes) : "0".repeat(64), content: null, byteSize: bytes?.byteLength ?? null });
        continue;
      }
      stored++;
      rows.push({ ...base, label: `Step ${step.index + 1}`, sha256: sha256(bytes!), content: Buffer.from(bytes!), contentType: "image/jpeg", byteSize: bytes!.byteLength });
    }
  }
  return { rows, skipped };
}

export async function storeEvidence(db: Db, rows: Row[]): Promise<void> {
  if (rows.length) await db.insert(evidence).values(rows);
}

/** Stored evidence bytes, for members of the run's project only. Anything else, or bytes whose hash changed, is not_found. */
export async function getEvidence(db: Db, args: { userId: string; evidenceId: string }): Promise<Result<{ content: Uint8Array; contentType: string }, "not_found">> {
  const nf = { ok: false, error: "not_found" } as const;
  if (!parseId(args.evidenceId)) return nf;
  const [ev] = await db
    .select({ content: evidence.content, contentType: evidence.contentType, sha256: evidence.sha256, milestoneId: submissions.milestoneId })
    .from(evidence)
    .innerJoin(verificationRuns, eq(verificationRuns.id, evidence.runId))
    .innerJoin(submissions, eq(submissions.id, verificationRuns.submissionId))
    .where(eq(evidence.id, args.evidenceId));
  if (!ev || !ev.content || !ev.contentType || !SERVABLE.has(ev.contentType)) return nf;
  const m = await milestoneProject(db, ev.milestoneId);
  if (!m) return nf;
  const role = await requireProjectRole(db, { userId: args.userId, projectId: m.projectId, allowed: ["client", "freelancer"] });
  if (!role.ok) return nf;
  if (sha256(ev.content) !== ev.sha256) {
    console.error("evidence hash mismatch:", args.evidenceId);
    return nf;
  }
  return { ok: true, value: { content: new Uint8Array(ev.content), contentType: ev.contentType } };
}
