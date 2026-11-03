import { describe, expect, it } from "vitest";
import { MILESTONE_EVENTS, MILESTONE_STATES, TRANSITIONS, nextState, type MilestoneState } from "./state-machine";

describe("milestone transition table", () => {
  it("returns the target state for every row in the table", () => {
    for (const t of TRANSITIONS) expect(nextState(t.from, t.event)).toEqual({ ok: true, value: t.to });
  });

  it("rejects every (state, event) pair that is not in the table", () => {
    let legal = 0;
    for (const from of MILESTONE_STATES) {
      for (const event of MILESTONE_EVENTS) {
        const row = TRANSITIONS.find((t) => t.from === from && t.event === event);
        const r = nextState(from, event);
        if (row) legal++;
        else expect(r).toEqual({ ok: false, error: "illegal_transition" });
      }
    }
    expect(legal).toBe(18);
  });

  it("says who must act: both parties to agree, either party to disagree", () => {
    expect(TRANSITIONS.find((t) => t.event === "both_approved")?.actor).toBe("both_required");
    expect(TRANSITIONS.find((t) => t.event === "disagree")?.actor).toBe("either_party");
    expect(TRANSITIONS.filter((t) => (t.actor as string) === "both")).toEqual([]);
  });

  it("has no transitions out of PAID or CANCELLED", () => {
    expect(TRANSITIONS.filter((t) => t.from === "PAID" || t.from === "CANCELLED")).toEqual([]);
  });

  it("has no path from APPROVED to PAID that skips RELEASED", () => {
    const seen = new Set<MilestoneState>(["APPROVED"]);
    const queue: MilestoneState[] = ["APPROVED"];
    while (queue.length) {
      const s = queue.shift()!;
      for (const t of TRANSITIONS.filter((x) => x.from === s && x.to !== "RELEASED")) {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      }
    }
    expect(seen.has("PAID")).toBe(false);
  });

  it("includes CAPTURE_PENDING between APPROVED and RELEASED", () => {
    expect(nextState("APPROVED", "capture_pending")).toEqual({ ok: true, value: "CAPTURE_PENDING" });
    expect(nextState("CAPTURE_PENDING", "capture_completed")).toEqual({ ok: true, value: "RELEASED" });
    expect(nextState("CAPTURE_PENDING", "payout_succeeded")).toEqual({ ok: false, error: "illegal_transition" });
  });
});
