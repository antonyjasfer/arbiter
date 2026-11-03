import { describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { upsertGithubUser } from "./upsert-user";

const db = setupTestDb();

describe("upsertGithubUser", () => {
  it("inserts a new user on first sign-in", async () => {
    const r = await upsertGithubUser(db(), { id: 42, login: "alice", name: "Alice", email: null, avatar_url: "https://a/x.png" });
    const rows = await db().select().from(s.users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.id, githubId: "42", login: "alice", name: "Alice", avatarUrl: "https://a/x.png" });
  });

  it("updates the same row when the GitHub login changes", async () => {
    const first = await upsertGithubUser(db(), { id: 42, login: "alice" });
    const second = await upsertGithubUser(db(), { id: 42, login: "alice-renamed", name: "Alice B" });
    expect(second.id).toBe(first.id);
    const rows = await db().select().from(s.users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ login: "alice-renamed", name: "Alice B" });
  });

  it("treats numeric and string GitHub ids as the same user", async () => {
    const a = await upsertGithubUser(db(), { id: 7, login: "bob" });
    const b = await upsertGithubUser(db(), { id: "7", login: "bob" });
    expect(b.id).toBe(a.id);
  });
});
