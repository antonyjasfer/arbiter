CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'approved', 'locked');--> statement-breakpoint
CREATE TYPE "public"."criterion_kind" AS ENUM('test', 'browser', 'static', 'review');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('log', 'screenshot', 'diff');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('client', 'freelancer');--> statement-breakpoint
CREATE TYPE "public"."milestone_state" AS ENUM('DRAFT', 'AGREED', 'FUNDED', 'SUBMITTED', 'VERIFYING', 'REPORT_READY', 'APPROVED', 'CAPTURE_PENDING', 'RELEASED', 'PAID', 'DISPUTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'errored');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pass', 'fail', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."verdict_source" AS ENUM('deterministic', 'ai');--> statement-breakpoint
CREATE TABLE "acceptance_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"kind" "criterion_kind" NOT NULL,
	"text" text NOT NULL,
	"spec_json" jsonb,
	"weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body_json" jsonb NOT NULL,
	"client_approved_at" timestamp with time zone,
	"freelancer_approved_at" timestamp with time zone,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_versions_agreement_version_uq" UNIQUE("agreement_id","version")
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"data" jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"verdict" "verdict" NOT NULL,
	"source" "verdict_source" NOT NULL,
	"confidence" numeric(3, 2),
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_result_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"uri" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"due_at" timestamp with time zone,
	"state" "milestone_state" DEFAULT 'DRAFT' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"paypal_order_id" text,
	"authorization_id" text,
	"capture_id" text,
	"payout_batch_id" text,
	"status" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"request_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_user_uq" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"repo_url" text NOT NULL,
	"commit_sha" char(40) NOT NULL,
	"deploy_url" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"paypal_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"workflow_run_id" bigint,
	"run_url" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"verified" boolean NOT NULL,
	"payload_sha256" char(64) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_status" text,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_criterion_id_acceptance_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."acceptance_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_check_result_id_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "public"."check_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_agreement_version_id_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."agreement_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acceptance_criteria_milestone_idx" ON "acceptance_criteria" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "agreements_project_idx" ON "agreements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_events_project_idx" ON "audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "check_results_run_idx" ON "check_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "check_results_criterion_idx" ON "check_results" USING btree ("criterion_id");--> statement-breakpoint
CREATE INDEX "disputes_milestone_idx" ON "disputes" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "disputes_author_idx" ON "disputes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "evidence_check_result_idx" ON "evidence" USING btree ("check_result_id");--> statement-breakpoint
CREATE INDEX "invitations_project_idx" ON "invitations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "invitations_accepted_by_idx" ON "invitations" USING btree ("accepted_by");--> statement-breakpoint
CREATE INDEX "milestones_agreement_version_idx" ON "milestones" USING btree ("agreement_version_id");--> statement-breakpoint
CREATE INDEX "milestones_state_idx" ON "milestones" USING btree ("state");--> statement-breakpoint
CREATE INDEX "payments_milestone_idx" ON "payments" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_created_by_idx" ON "projects" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "submissions_milestone_idx" ON "submissions" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "submissions_submitted_by_idx" ON "submissions" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "verification_runs_submission_idx" ON "verification_runs" USING btree ("submission_id");