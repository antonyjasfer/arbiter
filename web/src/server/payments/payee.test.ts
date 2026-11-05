import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { getPaypalEmail, setPaypalEmail } from "./payee";
import { auditActions, lockedProject, type Fixture } from "./test-fixtures";

const db = setupTestDb();
let f: Fixture;

beforeEach(async () => {
  f = await lockedProject(db(), { freelancerEmail: null });
});

describe("setPaypalEmail", () => {
  it("stores a valid email (trimmed) and reads it back", async () => {
    expect(await setPaypalEmail(db(), { userId: f.freelancer, email: "  new.payee@example.test " })).toEqual({ ok: true, value: undefined });
    expect(await getPaypalEmail(db(), f.freelancer)).toEqual({ email: "new.payee@example.test", isDemo: false });
  });

  it("rejects an invalid email and changes nothing", async () => {
    for (const email of ["", "not-an-email", "a@b", `${"x".repeat(250)}@example.test`]) {
      expect(await setPaypalEmail(db(), { userId: f.freelancer, email })).toEqual({ ok: false, error: "invalid_email" });
    }
    expect((await getPaypalEmail(db(), f.freelancer))?.email).toBeNull();
  });

  it("does not let a demo user change the seeded email", async () => {
    await db().update(s.users).set({ isDemo: true, paypalEmail: "seeded@example.test" }).where(eq(s.users.id, f.freelancer));
    expect(await setPaypalEmail(db(), { userId: f.freelancer, email: "other@example.test" })).toEqual({ ok: false, error: "demo_locked" });
    expect((await getPaypalEmail(db(), f.freelancer))?.email).toBe("seeded@example.test");
  });

  it("audits paypal_email_set in the freelancer's projects without the value", async () => {
    await setPaypalEmail(db(), { userId: f.freelancer, email: "new.payee@example.test" });
    expect(await auditActions(db(), f.projectId)).toContain("paypal_email_set");
    const events = await db().select({ action: s.auditEvents.action, data: s.auditEvents.data }).from(s.auditEvents).where(eq(s.auditEvents.action, "paypal_email_set"));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("payee@example");
  });

  it("does not audit when the email is unchanged", async () => {
    await setPaypalEmail(db(), { userId: f.freelancer, email: "same@example.test" });
    await setPaypalEmail(db(), { userId: f.freelancer, email: "same@example.test" });
    expect((await auditActions(db(), f.projectId)).filter((a) => a === "paypal_email_set")).toHaveLength(1);
  });
});
