import type { Result } from "@/lib/result";

// Milestone states and the typed transition table (docs/arbiter-plan.md section 7, Phase 1 CAPTURE_PENDING).
export const MILESTONE_STATES = [
  "DRAFT",
  "AGREED",
  "FUNDED",
  "SUBMITTED",
  "VERIFYING",
  "REPORT_READY",
  "APPROVED",
  "CAPTURE_PENDING",
  "RELEASED",
  "PAID",
  "DISPUTED",
  "CANCELLED",
] as const;

export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const MILESTONE_EVENTS = [
  "both_approved",
  "authorized",
  "authorization_lost",
  "cancel",
  "submit",
  "start_verification",
  "report_ready",
  "run_errored",
  "resubmit",
  "approve",
  "disagree",
  "capture_completed",
  "capture_pending",
  "capture_denied",
  "payout_succeeded",
] as const;

export type MilestoneEvent = (typeof MILESTONE_EVENTS)[number];
// both_required: both parties must act before the move happens; either_party: one party acting is enough.
export type TransitionActor = "client" | "freelancer" | "both_required" | "either_party" | "system";

// The only legal moves. Anything not listed is rejected.
// Phase 5 note: an authorization can also be lost while SUBMITTED, VERIFYING, REPORT_READY or DISPUTED;
// that path is designed in Phase 5 and deliberately not added here.
export const TRANSITIONS: readonly { from: MilestoneState; event: MilestoneEvent; to: MilestoneState; actor: TransitionActor }[] = [
  { from: "DRAFT", event: "both_approved", to: "AGREED", actor: "both_required" },
  { from: "AGREED", event: "authorized", to: "FUNDED", actor: "system" },
  { from: "FUNDED", event: "authorization_lost", to: "AGREED", actor: "system" },
  { from: "FUNDED", event: "cancel", to: "CANCELLED", actor: "client" },
  { from: "FUNDED", event: "submit", to: "SUBMITTED", actor: "freelancer" },
  { from: "SUBMITTED", event: "start_verification", to: "VERIFYING", actor: "system" },
  { from: "VERIFYING", event: "report_ready", to: "REPORT_READY", actor: "system" },
  { from: "VERIFYING", event: "run_errored", to: "SUBMITTED", actor: "system" },
  { from: "REPORT_READY", event: "resubmit", to: "SUBMITTED", actor: "freelancer" },
  { from: "REPORT_READY", event: "approve", to: "APPROVED", actor: "client" },
  { from: "REPORT_READY", event: "disagree", to: "DISPUTED", actor: "either_party" },
  { from: "DISPUTED", event: "approve", to: "APPROVED", actor: "client" },
  { from: "DISPUTED", event: "cancel", to: "CANCELLED", actor: "client" },
  // Payout waits for a COMPLETED capture: PAID is reachable only through RELEASED.
  { from: "APPROVED", event: "capture_completed", to: "RELEASED", actor: "system" },
  { from: "APPROVED", event: "capture_pending", to: "CAPTURE_PENDING", actor: "system" },
  { from: "CAPTURE_PENDING", event: "capture_completed", to: "RELEASED", actor: "system" },
  { from: "CAPTURE_PENDING", event: "capture_denied", to: "APPROVED", actor: "system" },
  { from: "RELEASED", event: "payout_succeeded", to: "PAID", actor: "system" },
];

export function nextState(from: MilestoneState, event: MilestoneEvent): Result<MilestoneState, "illegal_transition"> {
  const row = TRANSITIONS.find((t) => t.from === from && t.event === event);
  return row ? { ok: true, value: row.to } : { ok: false, error: "illegal_transition" };
}
