CREATE TYPE "public"."andonreasonenum" AS ENUM('quality', 'material', 'maintenance', 'safety', 'setup', 'other');--> statement-breakpoint
CREATE TYPE "public"."andonstateenum" AS ENUM('green', 'yellow', 'red', 'call');--> statement-breakpoint
CREATE TYPE "public"."andonstatusenum" AS ENUM('raised', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."interlockactionenum" AS ENUM('alert', 'block_downstream', 'stop_line', 'reduce_speed');--> statement-breakpoint
CREATE TYPE "public"."interlockeventstatusenum" AS ENUM('fired', 'proposed', 'auto_blocked', 'confirmed_blocked', 'alert_only', 'skipped', 'resolved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interlockscopeenum" AS ENUM('line', 'station', 'machine');--> statement-breakpoint
CREATE TYPE "public"."interlocksourcetypeenum" AS ENUM('spc_violation', 'ng_rate', 'process_result', 'telemetry_tag', 'cpk');--> statement-breakpoint
CREATE TABLE "andon_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" "andonstateenum" NOT NULL,
	"reason" "andonreasonenum" NOT NULL,
	"status" "andonstatusenum" DEFAULT 'raised' NOT NULL,
	"lineId" integer,
	"stationId" integer,
	"machineId" integer,
	"title" varchar(255) NOT NULL,
	"message" text,
	"raisedBy" integer,
	"raisedBySystem" boolean DEFAULT false NOT NULL,
	"sourceInterlockEventId" integer,
	"raisedAt" timestamp DEFAULT now() NOT NULL,
	"acknowledgedAt" timestamp,
	"acknowledgedBy" integer,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"escalationLevel" integer DEFAULT 0 NOT NULL,
	"mttaSeconds" integer,
	"mttrSeconds" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interlock_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruleId" integer NOT NULL,
	"firedAt" timestamp DEFAULT now() NOT NULL,
	"sourceType" "interlocksourcetypeenum",
	"observedValue" numeric(18, 6),
	"threshold" numeric(18, 6),
	"detail" jsonb,
	"action" "interlockactionenum",
	"status" "interlockeventstatusenum" DEFAULT 'fired' NOT NULL,
	"andonEventId" integer,
	"commandLogId" integer,
	"pendingActionId" varchar(64),
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interlock_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"scope" "interlockscopeenum" NOT NULL,
	"lineId" integer,
	"stationId" integer,
	"machineId" integer,
	"sourceType" "interlocksourcetypeenum" NOT NULL,
	"sourceKey" varchar(128),
	"comparisonOperator" "comparisonoperatorenum" NOT NULL,
	"threshold" numeric(18, 6),
	"windowSize" integer,
	"consecutiveCount" integer,
	"windowSeconds" integer,
	"action" "interlockactionenum" NOT NULL,
	"targetMachineId" integer,
	"targetAdapterId" integer,
	"commandTag" varchar(128),
	"commandValue" jsonb,
	"requiresHumanConfirm" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"approvedBy" integer,
	"approvedAt" timestamp,
	"cooldownSeconds" integer DEFAULT 300 NOT NULL,
	"lastFiredAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" integer
);
--> statement-breakpoint
CREATE INDEX "idx_andon_line" ON "andon_events" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_andon_station" ON "andon_events" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_andon_machine" ON "andon_events" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_andon_status" ON "andon_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_andon_raised" ON "andon_events" USING btree ("raisedAt");--> statement-breakpoint
CREATE INDEX "idx_interlock_events_rule" ON "interlock_events" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "idx_interlock_events_fired" ON "interlock_events" USING btree ("firedAt");--> statement-breakpoint
CREATE INDEX "idx_interlock_events_status" ON "interlock_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_interlock_rules_scope" ON "interlock_rules" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_interlock_rules_source" ON "interlock_rules" USING btree ("sourceType");--> statement-breakpoint
CREATE INDEX "idx_interlock_rules_enabled" ON "interlock_rules" USING btree ("enabled");