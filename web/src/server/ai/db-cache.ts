// AI output cache in Postgres (ai_cache), so cached demo compiles survive restarts and deploys.
import { eq } from "drizzle-orm";
import type { Db } from "../db/types";
import { aiCache } from "../db/schema";
import type { CacheStore } from "./structured-ai";

const KEY_RE = /^[0-9a-f]{64}$/;

export function dbCacheStore(db: Db, model: string): CacheStore {
  return {
    async get(key) {
      if (!KEY_RE.test(key)) return undefined;
      const [row] = await db.select({ value: aiCache.value }).from(aiCache).where(eq(aiCache.key, key));
      return row ? JSON.stringify(row.value) : undefined;
    },
    async set(key, value) {
      if (!KEY_RE.test(key)) return;
      await db.insert(aiCache).values({ key, model, value: JSON.parse(value) as unknown }).onConflictDoNothing();
    },
  };
}
