DO $$ BEGIN
  CREATE TYPE "public"."processresultenum" AS ENUM('pass', 'fail', 'warn', 'skip');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'FEEDER';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'ASSEMBLY';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'SCREWDRIVE';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'DISPENSING';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'ICT_FUNC';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'ROBOT_TEST';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'PACKAGING';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'PALLETIZER';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE IF NOT EXISTS 'ROBOT';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "process_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"serialNumber" varchar(128) NOT NULL,
	"machineId" integer NOT NULL,
	"machineType" "machinetypeenum",
	"stepType" varchar(64) NOT NULL,
	"stationId" integer,
	"lineCode" varchar(50),
	"productionOrderCode" varchar(80),
	"lotCode" varchar(80),
	"result" "processresultenum" NOT NULL,
	"metrics" jsonb,
	"recipeRef" varchar(128),
	"measuredAt" timestamp NOT NULL,
	"recordedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "capabilities" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_results_serial" ON "process_results" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_results_machine" ON "process_results" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_results_step" ON "process_results" USING btree ("stepType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_results_order" ON "process_results" USING btree ("productionOrderCode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_results_measured" ON "process_results" USING btree ("measuredAt");