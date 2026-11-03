// The app's AI instance: Gemini behind the StructuredAi interface. Tests pass their own StructuredAi.
import "server-only";
import { serverEnv } from "../env";
import { createGeminiAi } from "./gemini";
import type { StructuredAi } from "./structured-ai";

let ai: StructuredAi | undefined;

export function getAi(): StructuredAi {
  const env = serverEnv();
  ai ??= createGeminiAi(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  return ai;
}
