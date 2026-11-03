import { describe, expect, it } from "vitest";
import { setupTestDb } from "../db/test-db";
import * as s from "../db/schema";
import { dbCacheStore } from "./db-cache";

const db = setupTestDb();
const key = "a".repeat(64);

describe("dbCacheStore", () => {
  it("returns undefined for a missing key and round-trips a stored value", async () => {
    const store = dbCacheStore(db(), "gemini-3.6-flash");
    expect(await store.get(key)).toBeUndefined();
    await store.set(key, JSON.stringify({ data: { a: 1 }, usage: { inputTokens: 1, outputTokens: 2 } }));
    expect(JSON.parse((await store.get(key))!)).toEqual({ data: { a: 1 }, usage: { inputTokens: 1, outputTokens: 2 } });
    const [row] = await db().select().from(s.aiCache);
    expect(row!.model).toBe("gemini-3.6-flash");
  });

  it("keeps the first value when the same key is set twice", async () => {
    const store = dbCacheStore(db(), "m");
    await store.set(key, JSON.stringify({ data: 1 }));
    await store.set(key, JSON.stringify({ data: 2 }));
    expect(JSON.parse((await store.get(key))!)).toEqual({ data: 1 });
  });

  it("ignores a key that is not a sha256 hex string", async () => {
    const store = dbCacheStore(db(), "m");
    expect(await store.get("x")).toBeUndefined();
  });
});
