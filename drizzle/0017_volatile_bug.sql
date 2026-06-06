CREATE TYPE "public"."aiagentsessionstatus" AS ENUM('planning', 'awaiting_approval', 'running', 'awaiting_confirm', 'paused', 'done', 'aborted', 'failed');--> statement-breakpoint
CREATE TABLE "ai_agent_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"userRole" varchar(50) NOT NULL,
	"goal" text NOT NULL,
	"planJson" json,
	"cursor" integer DEFAULT 0 NOT NULL,
	"status" "aiagentsessionstatus" DEFAULT 'planning' NOT NULL,
	"stepResults" json DEFAULT '[]'::json NOT NULL,
	"linkedActionIds" json DEFAULT '[]'::json NOT NULL,
	"writeCount" integer DEFAULT 0 NOT NULL,
	"playbookId" varchar(120),
	"lang" varchar(5) DEFAULT 'vi' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_agent_sessions_user" ON "ai_agent_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_sessions_status" ON "ai_agent_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_agent_sessions_expires" ON "ai_agent_sessions" USING btree ("expiresAt");