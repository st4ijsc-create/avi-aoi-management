-- WS-4 — Predictive Maintenance + Auto-scheduling (additive, idempotent)
-- All new tables; NO changes to predictive_alerts / machine_health_history
-- (those already carry confidenceScore, predictedTimeframe, aiAnalysis,
--  predictedFailureRisk, recommendedMaintenanceDate, maintenanceUrgency).
-- Safe to run repeatedly (IF NOT EXISTS everywhere). No drops.

-- ── enum: schedule run lifecycle ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedulerunstatusenum') THEN
    CREATE TYPE "schedulerunstatusenum" AS ENUM ('DRAFT', 'APPLIED', 'DISMISSED');
  END IF;
END
$$;
--> statement-breakpoint

-- ── schedule_runs ──
CREATE TABLE IF NOT EXISTS "schedule_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "factoryId" integer,
  "lineId" integer,
  "algorithm" varchar(20) NOT NULL,
  "status" "schedulerunstatusenum" DEFAULT 'DRAFT' NOT NULL,
  "kpiSummary" json,
  "conflictCount" integer DEFAULT 0 NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "appliedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_runs_factory" ON "schedule_runs" ("factoryId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_runs_line" ON "schedule_runs" ("lineId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_runs_status" ON "schedule_runs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_runs_created" ON "schedule_runs" ("createdAt");
--> statement-breakpoint

-- ── schedule_run_items ──
CREATE TABLE IF NOT EXISTS "schedule_run_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "runId" integer NOT NULL,
  "productionOrderId" integer NOT NULL,
  "lineId" integer NOT NULL,
  "suggestedStart" timestamp NOT NULL,
  "suggestedEnd" timestamp NOT NULL,
  "reason" text,
  "applied" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_run_items_run" ON "schedule_run_items" ("runId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_run_items_order" ON "schedule_run_items" ("productionOrderId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_run_items_line" ON "schedule_run_items" ("lineId");
--> statement-breakpoint

-- ── machine_sensor_readings (optional, feature-flag; ingest NOT wired) ──
CREATE TABLE IF NOT EXISTS "machine_sensor_readings" (
  "id" serial PRIMARY KEY NOT NULL,
  "machineId" integer NOT NULL,
  "sensorType" varchar(50) NOT NULL,
  "value" numeric(12, 4) NOT NULL,
  "unit" varchar(20),
  "timestamp" timestamp NOT NULL,
  "source" varchar(50) DEFAULT 'mqtt',
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sensor_readings_machine_ts" ON "machine_sensor_readings" ("machineId", "timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sensor_readings_type" ON "machine_sensor_readings" ("sensorType");
