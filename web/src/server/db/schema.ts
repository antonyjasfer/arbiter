// Arbiter schema (docs/arbiter-plan.md section 7, Revision 2). IDs are uuid because they appear in URLs;
// money is numeric(12,2) read as a string, never a float.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { MILESTONE_STATES } from "../milestones/state-machine";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "string" });

export const memberRole = pgEnum("member_role", ["client", "freelancer"]);
export const agreementStatus = pgEnum("agreement_status", ["draft", "approved", "locked"]);
export const milestoneState = pgEnum("milestone_state", MILESTONE_STATES);
export const criterionKind = pgEnum("criterion_kind", ["test", "browser", "static", "review"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "completed", "errored"]);
export const verdict = pgEnum("verdict", ["pass", "fail", "needs_review"]);
export const verdictSource = pgEnum("verdict_source", ["deterministic", "ai"]);
export const evidenceType = pgEnum("evidence_type", ["log", "screenshot", "diff"]);

export const users = pgTable("users", {
  id: id(),
  githubId: text("github_id").notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  paypalEmail: text("paypal_email"),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: id(),
    title: text("title").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("projects_created_by_idx").on(t.createdBy)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("project_members_project_user_uq").on(t.projectId, t.userId), index("project_members_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    role: memberRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_project_idx").on(t.projectId), index("invitations_accepted_by_idx").on(t.acceptedBy)],
);

export const agreements = pgTable(
  "agreements",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    currentVersion: integer("current_version").notNull().default(1),
    status: agreementStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [index("agreements_project_idx").on(t.projectId)],
);

export const agreementVersions = pgTable(
  "agreement_versions",
  {
    id: id(),
    agreementId: uuid("agreement_id").notNull().references(() => agreements.id),
    version: integer("version").notNull(),
    bodyJson: jsonb("body_json").notNull(),
    clientApprovedAt: ts("client_approved_at"),
    freelancerApprovedAt: ts("freelancer_approved_at"),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("agreement_versions_agreement_version_uq").on(t.agreementId, t.version)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    agreementVersionId: uuid("agreement_version_id").notNull().references(() => agreementVersions.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    dueAt: ts("due_at"),
    state: milestoneState("state").notNull().default("DRAFT"),
    stateVersion: integer("state_version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_agreement_version_idx").on(t.agreementVersionId), index("milestones_state_idx").on(t.state)],
);

export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    kind: criterionKind("kind").notNull(),
    text: text("text").notNull(),
    specJson: jsonb("spec_json"),
    weight: integer("weight").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("acceptance_criteria_milestone_idx").on(t.milestoneId)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    repoUrl: text("repo_url").notNull(),
    commitSha: char("commit_sha", { length: 40 }).notNull(),
    deployUrl: text("deploy_url").notNull(),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("submissions_milestone_idx").on(t.milestoneId), index("submissions_submitted_by_idx").on(t.submittedBy)],
);

export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: id(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id),
    status: runStatus("status").notNull().default("queued"),
    workflowRunId: bigint("workflow_run_id", { mode: "number" }),
    runUrl: text("run_url"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("verification_runs_submission_idx").on(t.submissionId)],
);

export const checkResults = pgTable(
  "check_results",
  {
    id: id(),
    runId: uuid("run_id").notNull().references(() => verificationRuns.id),
    criterionId: uuid("criterion_id").notNull().references(() => acceptanceCriteria.id),
    verdict: verdict("verdict").notNull(),
    source: verdictSource("source").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2, mode: "string" }),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (t) => [index("check_results_run_idx").on(t.runId), index("check_results_criterion_idx").on(t.criterionId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    checkResultId: uuid("check_result_id").notNull().references(() => checkResults.id),
    type: evidenceType("type").notNull(),
    uri: text("uri").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_check_result_idx").on(t.checkResultId)],
);

// Revision 2: the "Disagree" button stores a comment here.
export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    comment: text("comment").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("disputes_milestone_idx").on(t.milestoneId), index("disputes_author_idx").on(t.authorId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    paypalOrderId: text("paypal_order_id"),
    authorizationId: text("authorization_id"),
    captureId: text("capture_id"),
    payoutBatchId: text("payout_batch_id"),
    status: text("status").notNull(),
    amount: money("amount").notNull(),
    requestIds: jsonb("request_ids").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("payments_milestone_idx").on(t.milestoneId)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: id(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  verified: boolean("verified").notNull(),
  payloadSha256: char("payload_sha256", { length: 64 }).notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  reconciledStatus: text("reconciled_status"),
  reconciledAt: ts("reconciled_at"),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    data: jsonb("data").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_project_idx").on(t.projectId), index("audit_events_actor_idx").on(t.actorId)],
);
