import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@/lib/canonical-json";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { verifyChain } from "../audit/audit";
import { createProject } from "../projects/projects";
import { acceptInvite, createInvite } from "../projects/invitations";
import type { AgreementBody, AgreementBodyInput } from "./body";
import { checkCompilerOutput } from "./compiler";
import { applyCompileResult, approve, createManualVersion, getCurrentVersion, saveEdit } from "./versions";

const db = setupTestDb();
const brief = "A small task-list web app with add, complete and filter, and a health check.";
let client: string, freelancer: string, outsider: string, projectId: string;

function sampleBody(): AgreementBody {
  const r = checkCompilerOutput(
    {
      milestones: [
        { title: "Working app, deployed", amount_cents: 15000, due_in_days: 7, criteria: [{ kind: "browser", text: "Adding Buy milk shows it." }, { kind: "review", text: "Easy to use." }] },
        { title: "Filters, validation and README", amount_cents: 15000, due_in_days: 14, criteria: [{ kind: "static", text: "README explains how to run it." }] },
      ],
      questions: [],
    },
    30000,
  );
  if (!r.ok) throw new Error("sample body");
  return r.value;
}

beforeEach(async () => {
  const users = await db()
    .insert(s.users)
    .values([
      { githubId: "1", login: "client" },
      { githubId: "2", login: "freelancer" },
      { githubId: "3", login: "outsider" },
    ])
    .returning();
  [client, freelancer, outsider] = users.map((u) => u.id) as [string, string, string];
  const p = await createProject(db(), { userId: client, title: "TaskBoard", brief, budgetCents: 30000 });
  if (!p.ok) throw new Error("setup");
  projectId = p.value.projectId;
  const inv = await createInvite(db(), { userId: client, projectId });
  if (!inv.ok) throw new Error("setup");
  await acceptInvite(db(), { userId: freelancer, token: inv.value.token });
  await db().transaction((tx) => applyCompileResult(tx, { projectId, userId: client, body: sampleBody(), jobId: null }));
});

async function current(userId = client) {
  const r = await getCurrentVersion(db(), { userId, projectId });
  if (!r.ok || !r.value) throw new Error("no current version");
  return r.value;
}

describe("applyCompileResult and getCurrentVersion", () => {
  it("creates version 1 from AI output with a canonical hash and per-milestone fees", async () => {
    const v = await current();
    expect(v).toMatchObject({ version: 1, source: "ai", clientApprovedAt: null, freelancerApprovedAt: null, locked: false });
    expect(v.hash).toBe(sha256Hex(canonicalJson({ projectId, version: 1, body: v.body })));
    expect(v.fees).toEqual([
      { key: "m1", feeCents: 850, payoutCents: 14150 },
      { key: "m2", feeCents: 850, payoutCents: 14150 },
    ]);
    expect((await current(freelancer)).hash).toBe(v.hash);
  });

  it("hides the agreement from non-members", async () => {
    expect(await getCurrentVersion(db(), { userId: outsider, projectId })).toEqual({ ok: false, error: { code: "not_member" } });
    expect(await getCurrentVersion(db(), { userId: client, projectId: "nope" })).toEqual({ ok: false, error: { code: "not_member" } });
  });
});

describe("createManualVersion", () => {
  it("lets the client write the next version by hand, checked like any other", async () => {
    const body = structuredClone((await current()).body);
    body.milestones[0]!.title = "Written by hand";
    expect(await createManualVersion(db(), { userId: client, projectId, body })).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await current()).toMatchObject({ version: 2, source: "manual", clientApprovedAt: null });
    const bad = structuredClone(body);
    bad.milestones[1]!.amountCents = 1;
    expect(await createManualVersion(db(), { userId: client, projectId, body: bad })).toMatchObject({ ok: false, error: { code: "invalid_body" } });
    expect(await createManualVersion(db(), { userId: freelancer, projectId, body })).toEqual({ ok: false, error: { code: "forbidden" } });
  });

  it("works on a project with no version yet, and refuses once locked", async () => {
    const p = await createProject(db(), { userId: client, title: "Blank", brief, budgetCents: 30000 });
    if (!p.ok) throw new Error("setup");
    const body = sampleBody();
    expect(await createManualVersion(db(), { userId: client, projectId: p.value.projectId, body })).toMatchObject({ ok: true, value: { version: 1 } });
    const v = await current();
    await approve(db(), { userId: client, projectId, expectedHash: v.hash });
    await approve(db(), { userId: freelancer, projectId, expectedHash: v.hash });
    expect(await createManualVersion(db(), { userId: client, projectId, body })).toEqual({ ok: false, error: { code: "locked" } });
  });
});

describe("one agreement per project", () => {
  it("rejects a second agreement row for the same project", async () => {
    await expect(db().insert(s.agreements).values({ projectId })).rejects.toThrow();
  });

  it("gives two simultaneous first versions one agreement and versions 1 and 2", async () => {
    const p = await createProject(db(), { userId: client, title: "Race", brief, budgetCents: 30000 });
    if (!p.ok) throw new Error("setup");
    const pid = p.value.projectId;
    await Promise.all([
      createManualVersion(db(), { userId: client, projectId: pid, body: sampleBody() }),
      db().transaction((tx) => applyCompileResult(tx, { projectId: pid, userId: client, body: sampleBody(), jobId: null })),
    ]);
    const rows = await db().select().from(s.agreements).where(eq(s.agreements.projectId, pid));
    expect(rows).toHaveLength(1);
    const versions = await db().select().from(s.agreementVersions).where(eq(s.agreementVersions.agreementId, rows[0]!.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });
});

describe("saveEdit", () => {
  it("keeps the AI's draft untouched: editing an AI version creates a new version", async () => {
    const v1 = await current();
    const body = structuredClone(v1.body);
    (body as AgreementBodyInput).milestones[0]!.criteria.push({ kind: "review", text: "The layout is easy to use." }); // new: no key
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: v1.hash, body })).toMatchObject({ ok: true, value: { version: 2 } });
    const v2 = await current();
    expect(v2).toMatchObject({ version: 2, source: "manual" });
    expect(v2.body.milestones[0]!.criteria.at(-1)).toMatchObject({ kind: "review", needsHumanJudgment: true });
    const [orig] = await db().select().from(s.agreementVersions).where(eq(s.agreementVersions.hash, v1.hash));
    expect(orig).toMatchObject({ version: 1, source: "ai" });
  });

  it("keeps keys stable across a saved edit and refuses invented keys", async () => {
    const v1 = await current();
    const body = structuredClone(v1.body) as AgreementBodyInput;
    body.milestones[0]!.criteria.push({ kind: "review", text: "Easy to use on a phone." }); // no key: server assigns
    const r = await saveEdit(db(), { userId: client, projectId, expectedHash: v1.hash, body });
    expect(r.ok).toBe(true);
    const v2 = await current();
    expect(v2.body.milestones[0]!.criteria.map((c) => c.key)).toEqual(["m1c1", "m1c2", "m1c3"]);
    const bad = structuredClone(v2.body) as AgreementBodyInput;
    bad.milestones[0]!.criteria[0]!.key = "m1c7";
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: v2.hash, body: bad })).toEqual({ ok: false, error: { code: "invalid_body", problems: [{ code: "invalid_keys" }] } });
  });

  it("edits an unapproved hand-written version in place", async () => {
    const v1 = await current();
    const first = structuredClone(v1.body);
    first.milestones[0]!.title = "Working app, deployed on Render";
    await saveEdit(db(), { userId: client, projectId, expectedHash: v1.hash, body: first }); // AI v1 -> manual v2
    const v2 = await current();
    const second = structuredClone(v2.body);
    second.milestones[0]!.title = "Working app, deployed on Render (HTTPS)";
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: v2.hash, body: second })).toMatchObject({ ok: true, value: { version: 2 } });
    const v = await current();
    expect(v.version).toBe(2);
    expect(v.hash).not.toBe(v2.hash);
    expect(v.body.milestones[0]!.title).toBe("Working app, deployed on Render (HTTPS)");
  });

  it("creates a new version and clears approvals when someone had already approved", async () => {
    const v1 = await current();
    expect((await approve(db(), { userId: client, projectId, expectedHash: v1.hash })).ok).toBe(true);
    const body = structuredClone(v1.body);
    body.milestones[1]!.criteria[0]!.text = "README explains how to run and test it.";
    expect((await saveEdit(db(), { userId: client, projectId, expectedHash: (await current()).hash, body })).ok).toBe(true);
    const v2 = await current();
    expect(v2).toMatchObject({ version: 2, clientApprovedAt: null, freelancerApprovedAt: null });
    // The freelancer's tab still shows version 1.
    expect(await approve(db(), { userId: freelancer, projectId, expectedHash: v1.hash })).toEqual({ ok: false, error: { code: "stale" } });
  });

  it("refuses a stale base, a freelancer editor and a body that breaks the budget", async () => {
    const v1 = await current();
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: "0".repeat(64), body: v1.body })).toEqual({ ok: false, error: { code: "stale" } });
    expect(await saveEdit(db(), { userId: freelancer, projectId, expectedHash: v1.hash, body: v1.body })).toEqual({ ok: false, error: { code: "forbidden" } });
    const bad = structuredClone(v1.body);
    bad.milestones[0]!.amountCents = 15001;
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: v1.hash, body: bad })).toEqual({
      ok: false,
      error: { code: "invalid_body", problems: [{ code: "sum_mismatch" }] },
    });
  });
});

describe("approve and lock", () => {
  it("locks once both approve: milestones AGREED, criteria stored, audit chain intact", async () => {
    const v = await current();
    expect(await approve(db(), { userId: client, projectId, expectedHash: v.hash })).toEqual({ ok: true, value: { locked: false } });
    expect(await approve(db(), { userId: freelancer, projectId, expectedHash: v.hash })).toEqual({ ok: true, value: { locked: true } });

    const after = await current();
    expect(after.locked).toBe(true);
    const ms = await db().select().from(s.milestones).where(eq(s.milestones.agreementVersionId, after.id)).orderBy(s.milestones.position);
    expect(ms.map((m) => [m.position, m.title, m.amount, m.state, m.stateVersion])).toEqual([
      [1, "Working app, deployed", "150.00", "AGREED", 1],
      [2, "Filters, validation and README", "150.00", "AGREED", 1],
    ]);
    const crit = await db().select().from(s.acceptanceCriteria).where(eq(s.acceptanceCriteria.milestoneId, ms[0]!.id));
    expect(crit.map((c) => c.kind).sort()).toEqual(["browser", "review"]);
    const [agreement] = await db().select().from(s.agreements).where(eq(s.agreements.projectId, projectId));
    expect(agreement!.status).toBe("locked");

    const actions = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId)).orderBy(s.auditEvents.seq)).map((e) => e.action);
    expect(actions.slice(-3)).toEqual(["approved", "approved", "locked"]);
    expect(await verifyChain(db(), projectId)).toMatchObject({ ok: true });
  });

  it("refuses edits and further approvals after the lock", async () => {
    const v = await current();
    await approve(db(), { userId: client, projectId, expectedHash: v.hash });
    await approve(db(), { userId: freelancer, projectId, expectedHash: v.hash });
    expect(await saveEdit(db(), { userId: client, projectId, expectedHash: v.hash, body: v.body })).toEqual({ ok: false, error: { code: "locked" } });
    expect(await approve(db(), { userId: client, projectId, expectedHash: v.hash })).toEqual({ ok: false, error: { code: "locked" } });
    await expect(db().transaction((tx) => applyCompileResult(tx, { projectId, userId: client, body: v.body, jobId: null }))).rejects.toThrow(/locked/);
  });

  it("treats a second approval by the same party as a no-op", async () => {
    const v = await current();
    await approve(db(), { userId: client, projectId, expectedHash: v.hash });
    expect(await approve(db(), { userId: client, projectId, expectedHash: v.hash })).toEqual({ ok: true, value: { locked: false } });
    const approvals = (await db().select().from(s.auditEvents).where(eq(s.auditEvents.projectId, projectId))).filter((e) => e.action === "approved");
    expect(approvals).toHaveLength(1);
  });

  it("refuses outsiders", async () => {
    const v = await current();
    expect(await approve(db(), { userId: outsider, projectId, expectedHash: v.hash })).toEqual({ ok: false, error: { code: "not_member" } });
  });
});
