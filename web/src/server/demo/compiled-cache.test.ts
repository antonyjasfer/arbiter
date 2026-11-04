import { describe, expect, it } from "vitest";
import { cacheKeyFor } from "../ai/structured-ai";
import { buildCompileRequest, checkCompilerOutput, compilerOutputSchema } from "../agreements/compiler";
import { DEFAULT_GEMINI_MODEL } from "../env";
import { DEMO_BRIEFS } from "./briefs";
import cache from "./compiled-cache.json";

// The fixture holds real Gemini outputs for the seed briefs (scripts/warm-demo-cache.ts). If the prompt,
// the schema or a brief changes, the cache key changes and this fails until the cache is re-warmed.
describe("compiled demo cache", () => {
  for (const b of DEMO_BRIEFS) {
    it(`holds a valid, checked output for "${b.title}" under the current cache key`, () => {
      const key = cacheKeyFor(DEFAULT_GEMINI_MODEL, buildCompileRequest({ brief: b.brief, budgetCents: b.budgetCents, answers: [] }));
      const entry = (cache as Record<string, { model: string; data: unknown }>)[key];
      expect(entry, `no cache entry for ${b.title}; run scripts/warm-demo-cache.ts`).toBeDefined();
      expect(entry!.model).toBe(DEFAULT_GEMINI_MODEL);
      const out = compilerOutputSchema.parse(entry!.data);
      expect(checkCompilerOutput(out, b.budgetCents).ok).toBe(true);
    });
  }

  it("asks the vague Bakery brief at least one question", () => {
    const b = DEMO_BRIEFS[1];
    const key = cacheKeyFor(DEFAULT_GEMINI_MODEL, buildCompileRequest({ brief: b.brief, budgetCents: b.budgetCents, answers: [] }));
    const entry = (cache as Record<string, { data: { questions: unknown[] } }>)[key];
    expect(entry?.data.questions.length ?? 0).toBeGreaterThan(0);
  });
});
