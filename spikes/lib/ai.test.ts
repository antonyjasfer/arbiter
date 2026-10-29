import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiHttpError, createStructuredAi, withCache, withRetry429, type RawJsonCall, type StructuredAi } from "./ai.js";

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
    const r = await createStructuredAi(raw, "m").generate(req);
    expect(r).toMatchObject({ ok: false, reason: "busy", retryAfterMs: 1500 });
  });

  it("maps other errors to reason error", async () => {
    const raw: RawJsonCall = async () => {
      throw new Error("boom");
    };
    const r = await createStructuredAi(raw, "m").generate(req);
    expect(r).toMatchObject({ ok: false, reason: "error" });
  });

  it("sends a JSON schema without the $schema key", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    await createStructuredAi(raw, "m").generate(req);
    const js = raw.mock.calls[0]?.[0].jsonSchema as Record<string, unknown>;
    expect(js).toBeTruthy();
    expect("$schema" in js).toBe(false);
    expect(js.type).toBe("object");
  });
});

describe("withRetry429", () => {
  const busy = { ok: false, reason: "busy", detail: "429" } as const;

  it("retries up to maxAttempts with increasing delays, then returns busy", async () => {
    const inner = { model: "m", generate: vi.fn(async () => busy) } as unknown as StructuredAi;
    const sleep = vi.fn(async (_ms: number) => {});
    const r = await withRetry429(inner, { maxAttempts: 3, baseMs: 100, sleep }).generate(req);
    expect(r).toMatchObject({ ok: false, reason: "busy" });
    expect(inner.generate).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    const [a, b] = [sleep.mock.calls[0]?.[0] ?? 0, sleep.mock.calls[1]?.[0] ?? 0];
    expect(b).toBeGreaterThan(a);
  });

  it("uses retryAfterMs when the failure carries it", async () => {
    const inner = {
      model: "m",
      generate: vi.fn(async () => ({ ...busy, retryAfterMs: 7000 })),
    } as unknown as StructuredAi;
    const sleep = vi.fn(async (_ms: number) => {});
    await withRetry429(inner, { maxAttempts: 2, baseMs: 100, sleep }).generate(req);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("does not retry a non-busy failure", async () => {
    const inner = {
      model: "m",
      generate: vi.fn(async () => ({ ok: false, reason: "error", detail: "x" })),
    } as unknown as StructuredAi;
    const sleep = vi.fn(async (_ms: number) => {});
    const r = await withRetry429(inner, { sleep }).generate(req);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(inner.generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("returns success as soon as a retry succeeds", async () => {
    const gen = vi.fn()
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce({ ok: true, data: { title: "a", n: 1 }, model: "m", cached: false, usage });
    const r = await withRetry429({ model: "m", generate: gen } as unknown as StructuredAi, { sleep: async () => {} }).generate(req);
    expect(r.ok).toBe(true);
    expect(gen).toHaveBeenCalledTimes(2);
  });
});

describe("withCache", () => {
  function memStore() {
    const m = new Map<string, string>();
    return { m, get: async (k: string) => m.get(k), set: async (k: string, v: string) => void m.set(k, v) };
  }

  it("serves the second identical call from the cache with cached:true", async () => {
    const raw = vi.fn<RawJsonCall>(async () => ({ text: '{"title":"a","n":1}', usage }));
    const store = memStore();
    const ai = withCache(createStructuredAi(raw, "m"), store);
    const first = await ai.generate(req);
    const second = await ai.generate(req);
    expect(first).toMatchObject({ ok: true, cached: false });
    expect(second).toMatchObject({ ok: true, cached: true, data: { title: "a", n: 1 } });
    expect(raw).toHaveBeenCalledTimes(1);
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
    expect(raw).toHaveBeenCalledTimes(2);
    expect(store.m.size).toBe(2);
  });
});
