DO $$ BEGIN
  CREATE TYPE "public"."commandstatusenum" AS ENUM('simulated', 'sent', 'acked', 'failed', 'timeout', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."deploymentstatusenum" AS ENUM('pending', 'deployed', 'failed', 'rolled_back');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."recipestatusenum" AS ENUM('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TYPE "public"."permissioncategoryenum" ADD VALUE IF NOT EXISTS 'machine_control';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "command_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actionId" varchar(64),
	"adapterId" integer NOT NULL,
	"machineId" integer,
	"tagKey" varchar(128),
	"address" varchar(255),
	"commandType" varchar(64),
	"requestedValue" jsonb,
	"requestedBy" integer NOT NULL,
	"confirmedBy" integer NOT NULL,
	"status" "commandstatusenum" DEFAULT 'simulated' NOT NULL,
	"ackValue" jsonb,
	"errorText" text,
	"idempotencyKey" varchar(128),
	"sentAt" timestamp,
	"ackedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "command_log_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machine_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer,
	"machineType" "machinetypeenum",
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"checksum" varchar(128),
	"status" "recipestatusenum" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_machine_recipes_code_version" UNIQUE("code","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipe_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipeId" integer NOT NULL,
	"machineId" integer NOT NULL,
	"adapterId" integer,
	"deployedBy" integer NOT NULL,
	"deployedAt" timestamp DEFAULT now() NOT NULL,
	"previousRecipeId" integer,
	"status" "deploymentstatusenum" DEFAULT 'pending' NOT NULL,
	"commandLogId" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_command_log_action" ON "command_log" USING btree ("actionId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_command_log_adapter" ON "command_log" USING btree ("adapterId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_command_log_machine" ON "command_log" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_command_log_status" ON "command_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_command_log_created" ON "command_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_recipes_machine" ON "machine_recipes" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_recipes_type" ON "machine_recipes" USING btree ("machineType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_recipes_status" ON "machine_recipes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipe_deployments_recipe" ON "recipe_deployments" USING btree ("recipeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipe_deployments_machine" ON "recipe_deployments" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipe_deployments_deployed" ON "recipe_deployments" USING btree ("deployedAt");
