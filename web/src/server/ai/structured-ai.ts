// Provider-neutral structured AI interface (moved from spikes/lib/ai.ts). Zod schema in, validated JSON out.
// Never throws: callers get a typed AiFailure. The model gets no tools; its output is data only.
import { createHash } from "node:crypto";
import { z } from "zod";

export type AiUsage = { inputTokens: number; outputTokens: number };
export type AiSuccess<T> = { ok: true; data: T; model: string; cached: boolean; usage: AiUsage };
export type AiFailure = {
  ok: false;
  reason: "busy" | "refused" | "invalid_output" | "error";
  detail: string;
  retryAfterMs?: number;
};
export type AiRequest<T> = { system: string; prompt: string; schema: z.ZodType<T>; schemaName: string };

export interface StructuredAi {
  readonly model: string;
  generate<T>(req: AiRequest<T>): Promise<AiSuccess<T> | AiFailure>;
}

export class AiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AiHttpError";
  }
}

export type RawJsonCall = (req: { system: string; prompt: string; jsonSchema: object }) => Promise<{ text: string; usage: AiUsage }>;

function toJsonSchema(schema: z.ZodType<unknown>): object {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export function createStructuredAi(raw: RawJsonCall, model: string): StructuredAi {
  return {
    model,
    async generate<T>(req: AiRequest<T>): Promise<AiSuccess<T> | AiFailure> {
      const jsonSchema = toJsonSchema(req.schema as z.ZodType<unknown>);
      let prompt = req.prompt;
      let lastProblem = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        let out: { text: string; usage: AiUsage };
        try {
          out = await raw({ system: req.system, prompt, jsonSchema });
        } catch (e) {
          if (e instanceof AiHttpError && e.status === 429) {
            return { ok: false, reason: "busy", detail: e.message, retryAfterMs: e.retryAfterMs };
          }
          return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
        }
        try {
          const data = req.schema.parse(JSON.parse(out.text));
          return { ok: true, data, model, cached: false, usage: out.usage };
        } catch (e) {
          lastProblem = e instanceof Error ? e.message : String(e);
          prompt = `${req.prompt}\n\nYour previous reply was invalid: ${lastProblem}\nReply again with JSON that matches the schema exactly.`;
        }
      }
      return { ok: false, reason: "invalid_output", detail: lastProblem };
    },
  };
}

export type CacheStore = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
};

/** The cache key for a request; seeded demo outputs are stored under it (see warm-demo-cache). */
export function cacheKeyFor(model: string, req: Pick<AiRequest<unknown>, "system" | "prompt" | "schemaName">): string {
  return createHash("sha256").update([model, req.system, req.prompt, req.schemaName].join("\u0000")).digest("hex");
}

export function withCache(ai: StructuredAi, store: CacheStore): StructuredAi {
  return {
    model: ai.model,
    async generate<T>(req: AiRequest<T>) {
      const key = cacheKeyFor(ai.model, req);
      const hit = await store.get(key);
      if (hit !== undefined) {
        try {
          const parsed = JSON.parse(hit) as { data: unknown; usage: AiUsage };
          return { ok: true, data: req.schema.parse(parsed.data), model: ai.model, cached: true, usage: parsed.usage } as AiSuccess<T>;
        } catch {
          // corrupt or stale entry: fall through to a live call
        }
      }
      const res = await ai.generate(req);
      if (res.ok) await store.set(key, JSON.stringify({ data: res.data, usage: res.usage }));
      return res;
    },
  };
}
