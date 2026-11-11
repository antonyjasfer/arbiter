// Architecture test: the only ways into FUNDED and REPORT_READY are a real PayPal authorization
// (payments/funding.ts) and a real verification run (verification/runs.ts). Fails if a shortcut comes back.
// Whether those moves happen after a real authorize / a real run is covered by funding.test.ts and runs.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "test-fixtures.ts") out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");
const files = [...sources(path.join(WEB, "src")), ...sources(path.join(WEB, "scripts"))];

describe("who may move a milestone into FUNDED or REPORT_READY", () => {
  it("only the transition table, funding.ts (authorized) and runs.ts (report_ready) name those events", () => {
    const hits = new Map<string, Set<string>>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/event:\s*"(authorized|report_ready)"/g)) {
        const k = rel(f);
        if (!hits.has(k)) hits.set(k, new Set());
        hits.get(k)!.add(m[1]!);
      }
    }
    expect(Object.fromEntries([...hits].map(([k, v]) => [k, [...v].sort()]))).toEqual({
      "src/server/milestones/state-machine.ts": ["authorized", "report_ready"],
      "src/server/payments/funding.ts": ["authorized"],
      "src/server/verification/runs.ts": ["report_ready"],
    });
  });

  it("no script under web/scripts can change a milestone's state", () => {
    const offenders = files
      .filter((f) => rel(f).startsWith("scripts/"))
      .filter((f) => /transitionMilestone|stateVersion|update\(\s*(s\.)?milestones\b/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
