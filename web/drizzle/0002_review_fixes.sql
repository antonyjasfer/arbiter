CREATE TABLE "ai_usage" (
	"day" text NOT NULL,
	"scope" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_scope_pk" PRIMARY KEY("day","scope")
);
--> statement-breakpoint
DROP INDEX "agreements_project_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "agreements_project_uq" ON "agreements" USING btree ("project_id");