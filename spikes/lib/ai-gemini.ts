// The ONLY file that imports @google/genai. Implements RawJsonCall via the Interactions API
// (documented as the current path on ai.google.dev, checked 29 Oct 2026). `store: false` keeps prompts out of stored interactions.
import { GoogleGenAI } from "@google/genai";
import { AiHttpError, type RawJsonCall } from "./ai.js";

function retryAfterFromMessage(message: string): number | undefined {
  // Google errors often say "Please retry in 12.3s" or carry a retryDelay like "12s".
  const m = /retry(?:\s+in|Delay"?\s*:\s*"?)\s*([0-9.]+)\s*s/i.exec(message);
  return m ? Math.ceil(parseFloat(m[1] as string) * 1000) : undefined;
}

export function createGeminiRaw(apiKey: string, model: string): RawJsonCall {
  // Free-tier calls can queue for a long time; never hang forever.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 90_000 } });
  return async ({ system, prompt, jsonSchema }) => {
    try {
      const interaction = await ai.interactions.create({
        model,
        input: prompt,
        system_instruction: system,
        store: false,
        response_format: { type: "text", mime_type: "application/json", schema: jsonSchema },
      } as Parameters<typeof ai.interactions.create>[0]);
      const i = interaction as unknown as {
        output_text?: string;
        status?: string;
        usage?: { total_input_tokens?: number; total_output_tokens?: number };
      };
      if (typeof i.output_text !== "string" || !i.output_text) {
        throw new Error(`Gemini returned no text (interaction status: ${i.status ?? "unknown"})`);
      }
      return {
        text: i.output_text,
        usage: { inputTokens: i.usage?.total_input_tokens ?? 0, outputTokens: i.usage?.total_output_tokens ?? 0 },
      };
    } catch (e) {
      const err = e as { status?: number; code?: number; message?: string };
      const status = err.status ?? err.code;
      const message = err.message ?? String(e);
      if (status === 429 || status === 503 || /RESOURCE_EXHAUSTED|high demand|UNAVAILABLE/i.test(message)) {
        throw new AiHttpError(429, message, retryAfterFromMessage(message)); // 429 and 503 both mean: busy, retry later
      }
      throw e;
    }
  };
}

/** Free-form metadata check: does the model id exist, and what token limits does it report? */
export async function getGeminiModelInfo(apiKey: string, model: string): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({ apiKey });
  const info = await ai.models.get({ model });
  const { name, displayName, inputTokenLimit, outputTokenLimit, supportedActions } = info as unknown as Record<string, unknown>;
  return { name, displayName, inputTokenLimit, outputTokenLimit, supportedActions };
}
