ALTER TYPE "public"."commandstatusenum" ADD VALUE 'acked_verified';--> statement-breakpoint
ALTER TYPE "public"."commandstatusenum" ADD VALUE 'acked_unverified';--> statement-breakpoint
ALTER TABLE "command_log" ADD COLUMN "readBackValue" jsonb;