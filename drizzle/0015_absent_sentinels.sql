CREATE TYPE "public"."commandtriggerkindenum" AS ENUM('hitl', 'interlock');--> statement-breakpoint
ALTER TABLE "command_log" ADD COLUMN "triggerKind" "commandtriggerkindenum" DEFAULT 'hitl' NOT NULL;--> statement-breakpoint
ALTER TABLE "command_log" ADD COLUMN "interlockRuleId" integer;--> statement-breakpoint
ALTER TABLE "command_log" ADD COLUMN "interlockEventId" integer;--> statement-breakpoint
ALTER TABLE "command_log" ADD COLUMN "approvedBy" integer;