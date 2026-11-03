CREATE TYPE "public"."compile_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"key" char(64) PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compile_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "compile_job_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"live" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD COLUMN "source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD COLUMN "compile_job_id" uuid;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "seq" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brief" text NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget" numeric(12, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brief_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "audit_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "audit_head_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "compile_jobs" ADD CONSTRAINT "compile_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compile_jobs" ADD CONSTRAINT "compile_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compile_jobs_project_idx" ON "compile_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "compile_jobs_requested_by_idx" ON "compile_jobs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "compile_jobs_due_idx" ON "compile_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_one_freelancer" ON "project_members" USING btree ("project_id") WHERE "project_members"."role" = 'freelancer';--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_seq_uq" UNIQUE("project_id","seq");