// TEST ONLY (Phase 4 demo; Phase 6 deletes this file). Moves one AGREED milestone to FUNDED directly in the
// database, so verification can be demonstrated before Phase 5's PayPal authorization is merged. It is a local
// CLI only: never an HTTP route or server action. It moves no money, calls no PayPal endpoint, and writes no
// "funded" audit event (that event means a real sandbox authorization; faking it would be a fake integration).
// Refuses to run unless PAYPAL_ENVIRONMENT is SANDBOX and an explicit milestone id is given.
// Run from web/:  node --conditions=react-server --import tsx scripts/dev-fund-milestone.ts <milestone-uuid>
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(process.cwd(), ".."), true, { info: () => {}, error: console.error }, true);

async function main() {
  const milestoneId = process.argv[2] ?? "";
  if (process.env.PAYPAL_ENVIRONMENT !== "SANDBOX") throw new Error("refused: PAYPAL_ENVIRONMENT is not SANDBOX");
  const { parseId } = await import("../src/lib/ids");
  if (!parseId(milestoneId)) throw new Error("usage: dev-fund-milestone.ts <milestone-uuid>");
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/server/db/client");
  const { milestones } = await import("../src/server/db/schema");
  const { transitionMilestone } = await import("../src/server/milestones/transition");
  const db = getDb();
  const [m] = await db.select({ state: milestones.state, stateVersion: milestones.stateVersion }).from(milestones).where(eq(milestones.id, milestoneId));
  if (!m) throw new Error("no such milestone");
  if (m.state !== "AGREED") throw new Error(`refused: milestone is ${m.state}, not AGREED`);
  const r = await transitionMilestone(db, { milestoneId, expectedState: "AGREED", expectedVersion: m.stateVersion, event: "authorized" });
  if (!r.ok) throw new Error(`transition failed: ${r.error}`);
  console.log(`milestone ${milestoneId}: AGREED -> FUNDED (test-only, no PayPal call, no money moved)`);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
