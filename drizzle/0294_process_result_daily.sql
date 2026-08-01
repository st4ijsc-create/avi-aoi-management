-- ============================================================================
-- Migration 0294: PROCESS ANALYTICS MART (doc 56 Đ5).
--
-- One read-optimised rollup row per (day, machineId, stepType) so fleet dashboards
-- read pass-rate/FPY trends without scanning the raw process_results row-store.
-- Refreshed by refreshProcessResultDaily() (idempotent upsert on the unique key);
-- dashboards fall back to a live aggregate when the mart is cold. Populated by
-- NOTHING until PROCESS_ANALYTICS_ENABLED is on ⇒ inert on apply (safe to ship dark).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE IF NOT EXISTS; unique + indexes IF NOT EXISTS.
-- ROLLBACK: DROP TABLE IF EXISTS "process_result_daily";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "process_result_daily" (
  "id"             serial PRIMARY KEY,
  "day"            date NOT NULL,
  "machineId"      integer NOT NULL,
  "machineType"    "machinetypeenum",
  "stepType"       varchar(64) NOT NULL,
  "pass"           integer NOT NULL DEFAULT 0,
  "fail"           integer NOT NULL DEFAULT 0,
  "warn"           integer NOT NULL DEFAULT 0,
  "skip"           integer NOT NULL DEFAULT 0,
  "total"          integer NOT NULL DEFAULT 0,
  "firstPassYield" double precision,
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_process_result_daily"
  ON "process_result_daily" ("day","machineId","stepType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_result_daily_day"
  ON "process_result_daily" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_result_daily_machine"
  ON "process_result_daily" ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_process_result_daily_type"
  ON "process_result_daily" ("machineType");
