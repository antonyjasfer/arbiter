// Ported from spikes/lib/ai.test.ts (withRetry429 dropped: compile jobs back off between attempts instead).
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiHttpError, cacheKeyFor, createStructuredAi, withCache, type RawJsonCall } from "./structured-ai";

const Schema = z.object({ title: z.string(), n: z.number() });
const req = { system: "sys", prompt: "make json", schema: Schema, schemaName: "Demo" };
const usage = { inputTokens: 3, outputTokens: 4 };

describe("createStructuredAi", () => {
  it("returns validated data on valid JSON", async () => {
    const raw: RawJsonCall = vi.fn(async () => ({ text: '{"title":"a","n":1}', usage }));
    const r = await createStructuredAi(raw, "m").generate(req);
    expect(r).toMatchObject({ ok: true, cached: false, model: "m", data: { title: "a", n: 1 } });
  });

  it("re-asks once with the validation error when the first reply is invalid", async () => {
    const raw = vi.fn<RawJsonCall>()
      .mockResolvedValueOnce({ text: "not json at all", usage })
      .mockResolvedValueOnce({ text: '{"title":"a","n":2}', usage });
    const r = await createStructuredAi(raw, "m").generate(req);
    expect(r.ok).toBe(true);
    expect(raw).toHaveBeenCalledTimes(2);
    const secondPrompt = raw.mock.calls[1]?.[0].prompt ?? "";
    expect(secondPrompt).toContain("make json");
    expect(secondPrompt.toLowerCase()).toContain("invalid");
  });

  it("returns invalid_output after exactly two invalid replies", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":1}', usage }));
    const r = await createStructuredAi(raw, "m").generate(req);
    expect(r).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("maps a 429 to a busy failure carrying retryAfterMs, and does not throw", async () => {
    const raw: RawJsonCall = async () => {
      throw new AiHttpError(429, "slow down", 1500);
    };
    expect(await createStructuredAi(raw, "m").generate(req)).toMatchObject({ ok: false, reason: "busy", retryAfterMs: 1500 });
  });

  it("maps other errors to reason error", async () => {
    const raw: RawJsonCall = async () => {
      throw new Error("boom");
    };
    expect(await createStructuredAi(raw, "m").generate(req)).toMatchObject({ ok: false, reason: "error" });
  });

  it("sends a JSON schema without the $schema key", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    await createStructuredAi(raw, "m").generate(req);
    const js = raw.mock.calls[0]?.[0].jsonSchema as Record<string, unknown>;
    expect("$schema" in js).toBe(false);
    expect(js.type).toBe("object");
  });
});

describe("withCache", () => {
  function memStore() {
    const m = new Map<string, string>();
    return { m, get: async (k: string) => m.get(k), set: async (k: string, v: string) => void m.set(k, v) };
  }

  it("serves the second identical call from the cache with cached:true, under cacheKeyFor's key", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    const store = memStore();
    const ai = withCache(createStructuredAi(raw, "m"), store);
    expect(await ai.generate(req)).toMatchObject({ ok: true, cached: false });
    expect(await ai.generate(req)).toMatchObject({ ok: true, cached: true, data: { title: "a", n: 1 } });
    expect(raw).toHaveBeenCalledTimes(1);
    expect([...store.m.keys()]).toEqual([cacheKeyFor("m", req)]);
  });

  it("never caches a failure", async () => {
    const raw = vi.fn<RawJsonCall>(async () => {
      throw new AiHttpError(429, "busy");
    });
    const store = memStore();
    const ai = withCache(createStructuredAi(raw, "m"), store);
    await ai.generate(req);
    await ai.generate(req);
    expect(store.m.size).toBe(0);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("uses different keys for different prompts", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    const store = memStore();
    const ai = withCache(createStructuredAi(raw, "m"), store);
    await ai.generate(req);
    await ai.generate({ ...req, prompt: "different" });
    expect(store.m.size).toBe(2);
  });

  it("falls through to a live call when the cached value is corrupt", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    const store = memStore();
    store.m.set(cacheKeyFor("m", req), "{not json");
    const r = await withCache(createStructuredAi(raw, "m"), store).generate(req);
    expect(r).toMatchObject({ ok: true, cached: false });
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
