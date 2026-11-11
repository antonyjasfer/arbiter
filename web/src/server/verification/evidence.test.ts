import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import type { Results } from "./plan-dsl";
import { getEvidence, MAX_SHOT_BYTES, MAX_SHOTS, planEvidence } from "./evidence";
import { lockedProject, type Fixture } from "./test-fixtures";

const RUN_URL = "https://github.com/antonyjasfer/arbiter-runner/actions/runs/4242";
const jpeg = (n: number) => {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const shotStep = (index: number, screenshot: string | null) => ({ index, op: "goto" as const, status: "pass" as const, reason: null, ms: 1, actual_status: 200, mismatched_keys: [], screenshot });
function results(criteria: Results["criteria"]): Results {
  return { version: 1, run_name: "90dd55d7-40a8-4c87-9f2a-8959613c62ac", plan_sha256: "a".repeat(64), status: "ok", plan_error: null, warmup: { ok: true, attempts: 1, ms: 1, status: 200 }, criteria, screenshots_skipped: 0 };
}

describe("planEvidence", () => {
  it("stores the public run link as run-level run_link evidence", () => {
    const { rows } = planEvidence({ runId: "r1", runUrl: RUN_URL, files: {}, results: null, checkResultIdByKey: {} });
    expect(rows).toEqual([expect.objectContaining({ runId: "r1", checkResultId: null, type: "run_link", uri: RUN_URL, content: null })]);
  });

  it("stores each screenshot against its criterion with its SHA-256, and results.json at run level", () => {
    const shot = jpeg(1000);
    const json = new TextEncoder().encode("{}");
    const r = results({ m1c1: { status: "pass", failed_step: null, reason: null, steps: [shotStep(0, "shots/0.jpg")] } });
    const { rows, skipped } = planEvidence({ runId: "r1", runUrl: RUN_URL, files: { "shots/0.jpg": shot, "results.json": json }, results: r, checkResultIdByKey: { m1c1: "c1" } });
    const s0 = rows.find((x) => x.type === "screenshot")!;
    expect(s0).toMatchObject({ checkResultId: "c1", runId: "r1", contentType: "image/jpeg", byteSize: 1000, sha256: createHash("sha256").update(shot).digest("hex") });
    expect(rows.find((x) => x.type === "results")).toMatchObject({ checkResultId: null, contentType: "application/json" });
    expect(skipped).toEqual([]);
  });

  it("does not store a screenshot over 300 KB, or past 20 per run, and records it as skipped", () => {
    const steps = Array.from({ length: MAX_SHOTS + 2 }, (_, i) => shotStep(i % 15, `shots/${i}.jpg`));
    const files: Record<string, Uint8Array> = {};
    steps.forEach((st, i) => (files[st.screenshot!] = jpeg(i === 0 ? MAX_SHOT_BYTES + 1 : 100)));
    const crit = Object.fromEntries(Array.from({ length: 2 }, (_, c) => [`m1c${c + 1}`, { status: "pass" as const, failed_step: null, reason: null, steps: steps.slice(c * 11, c * 11 + 11) }]));
    const { rows, skipped } = planEvidence({ runId: "r1", runUrl: RUN_URL, files, results: results(crit), checkResultIdByKey: { m1c1: "c1", m1c2: "c2" } });
    const stored = rows.filter((x) => x.type === "screenshot" && x.content !== null);
    expect(stored).toHaveLength(MAX_SHOTS);
    expect(stored.every((x) => (x.byteSize ?? 0) <= MAX_SHOT_BYTES)).toBe(true);
    expect(skipped).toEqual(expect.arrayContaining([{ path: "shots/0.jpg", reason: "too_large" }, expect.objectContaining({ reason: "over_limit" })]));
    expect(rows.filter((x) => x.type === "screenshot" && x.content === null)).toHaveLength(skipped.length);
  });

  it("does not store a file that is not a JPEG", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    const r = results({ m1c1: { status: "pass", failed_step: null, reason: null, steps: [shotStep(0, "shots/0.jpg")] } });
    const { skipped } = planEvidence({ runId: "r1", runUrl: RUN_URL, files: { "shots/0.jpg": html }, results: r, checkResultIdByKey: { m1c1: "c1" } });
    expect(skipped).toEqual([{ path: "shots/0.jpg", reason: "not_jpeg" }]);
  });
});

describe("getEvidence", () => {
  const db = setupTestDb();
  let f: Fixture;
  let evidenceId: string;
  const shot = jpeg(500);

  beforeEach(async () => {
    f = await lockedProject(db());
    const [sub] = await db().insert(s.submissions).values({ milestoneId: f.milestoneId, repoUrl: "https://github.com/a/b", commitSha: "c".repeat(40), deployUrl: "https://b.onrender.com", submittedBy: f.freelancer }).returning();
    const [run] = await db().insert(s.verificationRuns).values({ submissionId: sub!.id, status: "completed" }).returning();
    const [ev] = await db()
      .insert(s.evidence)
      .values({ runId: run!.id, type: "screenshot", uri: "artifact:shots/0.jpg", sha256: createHash("sha256").update(shot).digest("hex"), content: Buffer.from(shot), contentType: "image/jpeg", byteSize: shot.byteLength })
      .returning();
    evidenceId = ev!.id;
  });

  it("serves the bytes to project members", async () => {
    for (const userId of [f.client, f.freelancer]) {
      const r = await getEvidence(db(), { userId, evidenceId });
      expect(r.ok && Buffer.from(r.value.content).equals(Buffer.from(shot)) && r.value.contentType).toBe("image/jpeg");
    }
  });

  it("is not_found for a non-member, across the demo boundary, and for a malformed id", async () => {
    expect(await getEvidence(db(), { userId: f.outsider, evidenceId })).toEqual({ ok: false, error: "not_found" });
    const demo = await lockedProject(db(), { demo: true, tag: "d" });
    expect(await getEvidence(db(), { userId: demo.client, evidenceId })).toEqual({ ok: false, error: "not_found" });
    expect(await getEvidence(db(), { userId: f.client, evidenceId: "../etc/passwd" })).toEqual({ ok: false, error: "not_found" });
  });

  it("checks the SHA-256 again when serving, and refuses changed bytes", async () => {
    await db().update(s.evidence).set({ content: Buffer.from(jpeg(501)) }).where(eq(s.evidence.id, evidenceId));
    expect(await getEvidence(db(), { userId: f.client, evidenceId })).toEqual({ ok: false, error: "not_found" });
  });
});
