// Milestone states. Transitions are added in Task 4.
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
