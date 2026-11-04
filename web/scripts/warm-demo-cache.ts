// Runs the real Agreement Compiler (live Gemini) on the two seed briefs and writes the outputs to
// src/server/demo/compiled-cache.json, keyed exactly as the app's cache. An output is written only if it
// passes the same deterministic checks the app applies; nothing here is hand-written.
// Run from web/:  node --conditions=react-server --import tsx scripts/warm-demo-cache.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(process.cwd(), ".."), true, { info: () => {}, error: console.error }, true);

async function main() {
  const { createGeminiAi } = await import("../src/server/ai/gemini");
  const { cacheKeyFor } = await import("../src/server/ai/structured-ai");
  const { buildCompileRequest, checkCompilerOutput } = await import("../src/server/agreements/compiler");
  const { DEMO_BRIEFS } = await import("../src/server/demo/briefs");
  const { DEFAULT_GEMINI_MODEL } = await import("../src/server/env");

  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set (name only; the value is never printed)");
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const ai = createGeminiAi(key, model);
  const out: Record<string, { model: string; data: unknown; usage: unknown; createdAt: string }> = {};

  for (const b of DEMO_BRIEFS) {
    const req = buildCompileRequest({ brief: b.brief, budgetCents: b.budgetCents, answers: [] });
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const t0 = Date.now();
      const res = await ai.generate(req);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok) {
        console.log(`${b.title}: attempt ${attempt} ${res.reason} after ${secs}s`);
        if (res.reason === "busy" || res.reason === "error") await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      const checked = checkCompilerOutput(res.data, b.budgetCents);
      if (!checked.ok) {
        console.log(`${b.title}: attempt ${attempt} failed checks after ${secs}s: ${JSON.stringify(checked.error)}`);
        continue;
      }
      const m = checked.value.milestones;
      console.log(
        `${b.title}: OK in ${secs}s, ${m.length} milestones (${m.map((x) => x.amountCents).join(" + ")} cents), ` +
          `${m.flatMap((x) => x.criteria).length} criteria, ${checked.value.questions.length} questions, tokens ${res.usage.inputTokens}/${res.usage.outputTokens}`,
      );
      out[cacheKeyFor(model, req)] = { model, data: res.data, usage: res.usage, createdAt: new Date().toISOString() };
      done = true;
    }
    if (!done) throw new Error(`${b.title}: no valid output after 3 attempts; nothing written`);
  }
  writeFileSync(path.resolve(process.cwd(), "src/server/demo/compiled-cache.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${Object.keys(out).length} entries to src/server/demo/compiled-cache.json`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
