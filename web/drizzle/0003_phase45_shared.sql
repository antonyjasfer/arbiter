ALTER TYPE "public"."evidence_type" ADD VALUE 'results';--> statement-breakpoint
ALTER TYPE "public"."evidence_type" ADD VALUE 'run_link';--> statement-breakpoint
CREATE TABLE "check_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"milestone_id" uuid NOT NULL,
	"criteria_hash" char(64) NOT NULL,
	"plan" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_plans_milestone_id_unique" UNIQUE("milestone_id")
);
--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "check_result_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "check_results" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "check_results" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "content" "bytea";--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payout_item_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "authorization_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "capture_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payout_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payout_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payee_email" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "authorization_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "honor_period_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "state_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "injection_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "injection_scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "dispatch_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "plan_hash" char(64);--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "jobs_summary" jsonb;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "check_plans" ADD CONSTRAINT "check_plans_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_run_idx" ON "evidence" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_live_per_milestone" ON "payments" USING btree ("milestone_id") WHERE "payments"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_paypal_order_uq" ON "payments" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "payments_authorization_idx" ON "payments" USING btree ("authorization_id");--> statement-breakpoint
CREATE INDEX "payments_capture_idx" ON "payments" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "payments_payout_batch_idx" ON "payments" USING btree ("payout_batch_id");--> statement-breakpoint
CREATE INDEX "payments_payout_item_idx" ON "payments" USING btree ("payout_item_id");--> statement-breakpoint
CREATE INDEX "payments_created_by_idx" ON "payments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "payments_approved_by_idx" ON "payments" USING btree ("approved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_one_live_per_milestone" ON "submissions" USING btree ("milestone_id") WHERE "submissions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "verification_runs_requested_by_idx" ON "verification_runs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "verification_runs_due_idx" ON "verification_runs" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_run_criterion_uq" UNIQUE("run_id","criterion_id");--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_dispatch_key_unique" UNIQUE("dispatch_key");