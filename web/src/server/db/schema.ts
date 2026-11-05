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
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

// Postgres bytea as a Node Buffer (evidence screenshots; drizzle 0.45 has no built-in bytea column).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
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
export const evidenceType = pgEnum("evidence_type", ["log", "screenshot", "diff", "results", "run_link"]);
export const compileJobStatus = pgEnum("compile_job_status", ["queued", "running", "succeeded", "failed"]);

export const users = pgTable("users", {
  id: id(),
  githubId: text("github_id").notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  paypalEmail: text("paypal_email"),
  // Demo users see only demo projects, and real users never see them.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: id(),
    title: text("title").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    brief: text("brief").notNull(),
    budget: money("budget").notNull(),
    briefFlags: jsonb("brief_flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // Head of this project's audit chain, updated in the same transaction as each audit event.
    auditSeq: integer("audit_seq").notNull().default(0),
    auditHeadHash: text("audit_head_hash"),
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
  (t) => [
    unique("project_members_project_user_uq").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
    uniqueIndex("project_members_one_freelancer").on(t.projectId).where(sql`${t.role} = 'freelancer'`),
  ],
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
  // One agreement per project; concurrent first versions then share it (review fix, Phase 3).
  (t) => [uniqueIndex("agreements_project_uq").on(t.projectId)],
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
    createdBy: uuid("created_by").references(() => users.id),
    source: text("source").$type<"ai" | "manual">().notNull(),
    compileJobId: uuid("compile_job_id"),
    lockedAt: ts("locked_at"),
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
    // Phase 4: text aimed at AI reviewers found in the repo at this commit (read via the GitHub API, never run).
    injectionFlags: jsonb("injection_flags").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    injectionScannedAt: ts("injection_scanned_at"),
    // Set when a resubmission replaces this one; at most one live submission per milestone.
    supersededAt: ts("superseded_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("submissions_milestone_idx").on(t.milestoneId),
    index("submissions_submitted_by_idx").on(t.submittedBy),
    uniqueIndex("submissions_one_live_per_milestone").on(t.milestoneId).where(sql`${t.supersededAt} is null`),
  ],
);

// Phase 4: the Check Planner's output for a milestone (a validated DSL, never code), reused across
// resubmissions while the criteria are unchanged.
export const checkPlans = pgTable("check_plans", {
  id: id(),
  milestoneId: uuid("milestone_id").notNull().unique().references(() => milestones.id),
  criteriaHash: char("criteria_hash", { length: 64 }).notNull(),
  plan: jsonb("plan").notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

// A verification run is a DB job with a lease, like compile_jobs: dispatched to arbiter-runner, matched
// to its workflow run by dispatch_key (the run-name), polled, and timed out at deadline_at.
export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: id(),
    submissionId: uuid("submission_id").notNull().references(() => submissions.id),
    requestedBy: uuid("requested_by").references(() => users.id),
    status: runStatus("status").notNull().default("queued"),
    dispatchKey: uuid("dispatch_key").notNull().unique().defaultRandom(),
    plan: jsonb("plan"),
    planHash: char("plan_hash", { length: 64 }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    leaseUntil: ts("lease_until"),
    deadlineAt: ts("deadline_at"),
    workflowRunId: bigint("workflow_run_id", { mode: "number" }),
    runUrl: text("run_url"),
    jobsSummary: jsonb("jobs_summary"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("verification_runs_submission_idx").on(t.submissionId),
    index("verification_runs_requested_by_idx").on(t.requestedBy),
    index("verification_runs_due_idx").on(t.status, t.nextAttemptAt),
  ],
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
    // Phase 4: the deterministic step results behind the verdict, and the Evidence Reviewer's plain-language
    // summary (which can never change the verdict).
    detail: jsonb("detail"),
    aiSummary: text("ai_summary"),
    createdAt: createdAt(),
  },
  (t) => [
    index("check_results_run_idx").on(t.runId),
    index("check_results_criterion_idx").on(t.criterionId),
    unique("check_results_run_criterion_uq").on(t.runId, t.criterionId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    // A criterion's evidence, or (check_result_id null) run-level evidence such as the public run link.
    checkResultId: uuid("check_result_id").references(() => checkResults.id),
    runId: uuid("run_id").references(() => verificationRuns.id),
    type: evidenceType("type").notNull(),
    label: text("label"),
    uri: text("uri").notNull(),
    sha256: char("sha256", { length: 64 }).notNull(),
    // Screenshots and results files are stored here (size-capped) and served by Arbiter.
    content: bytea("content"),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_check_result_idx").on(t.checkResultId), index("evidence_run_idx").on(t.runId)],
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

// One row per funding attempt of a milestone. A lost or voided authorization is superseded by the next
// funding attempt, so at most one live payment exists per milestone. Statuses mirror what PayPal reported
// at the last reconcile; state_version guards every update.
export const payments = pgTable(
  "payments",
  {
    id: id(),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id),
    createdBy: uuid("created_by").references(() => users.id),
    paypalOrderId: text("paypal_order_id"),
    authorizationId: text("authorization_id"),
    captureId: text("capture_id"),
    payoutBatchId: text("payout_batch_id"),
    payoutItemId: text("payout_item_id"),
    status: text("status").notNull(),
    authorizationStatus: text("authorization_status"),
    captureStatus: text("capture_status"),
    payoutStatus: text("payout_status"),
    amount: money("amount").notNull(),
    fee: money("fee"),
    payoutAmount: money("payout_amount"),
    payeeEmail: text("payee_email"),
    authorizationExpiresAt: ts("authorization_expires_at"),
    honorPeriodEndsAt: ts("honor_period_ends_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    // A written client override that allows release despite a FAIL (payment guard).
    overrideReason: text("override_reason"),
    voidedAt: ts("voided_at"),
    lastReconciledAt: ts("last_reconciled_at"),
    requestIds: jsonb("request_ids").notNull().default(sql`'{}'::jsonb`),
    stateVersion: integer("state_version").notNull().default(0),
    supersededAt: ts("superseded_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payments_milestone_idx").on(t.milestoneId),
    uniqueIndex("payments_one_live_per_milestone").on(t.milestoneId).where(sql`${t.supersededAt} is null`),
    uniqueIndex("payments_paypal_order_uq").on(t.paypalOrderId),
    index("payments_authorization_idx").on(t.authorizationId),
    index("payments_capture_idx").on(t.captureId),
    index("payments_payout_batch_idx").on(t.payoutBatchId),
    index("payments_payout_item_idx").on(t.payoutItemId),
    index("payments_created_by_idx").on(t.createdBy),
    index("payments_approved_by_idx").on(t.approvedBy),
  ],
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
    // 1, 2, 3... per project; a gap means a deleted event.
    seq: integer("seq").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    data: jsonb("data").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().unique(),
    // Set by the app (not defaultNow) because it is part of the hashed content.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("audit_events_project_idx").on(t.projectId),
    index("audit_events_actor_idx").on(t.actorId),
    unique("audit_events_project_seq_uq").on(t.projectId, t.seq),
  ],
);

// Agreement Compiler runs, persisted so a restart or cold start resumes them (never in-memory timers).
export const compileJobs = pgTable(
  "compile_jobs",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    status: compileJobStatus("status").notNull().default("queued"),
    input: jsonb("input").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    leaseUntil: ts("lease_until"),
    // True once a claim made a model call that missed the cache; counts toward the daily caps.
    live: boolean("live").notNull().default(false),
    result: jsonb("result"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("compile_jobs_project_idx").on(t.projectId),
    index("compile_jobs_requested_by_idx").on(t.requestedBy),
    index("compile_jobs_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

// Live (uncached) AI calls per UTC day, per scope ("user:<id>" or "demo"). Kept apart from compile_jobs
// so a demo Reset, which deletes demo jobs, cannot reset the daily caps (review fix, Phase 3).
export const aiUsage = pgTable(
  "ai_usage",
  {
    day: text("day").notNull(),
    scope: text("scope").notNull(),
    n: integer("n").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.scope] })],
);

export const aiCache = pgTable("ai_cache", {
  key: char("key", { length: 64 }).primaryKey(),
  model: text("model").notNull(),
  value: jsonb("value").notNull(),
  createdAt: createdAt(),
});
