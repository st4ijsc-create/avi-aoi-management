-- 0116 G2.5a APS: machine_capacity resource table + schedule_run_items APS columns
-- Additive ONLY. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
-- KHÔNG ALTER/DROP bảng cũ, KHÔNG tạo enum mới. Safe to re-run.
-- APS chỉ sinh scheduleRuns DRAFT (đề xuất) — không ghi máy/lệnh điều khiển.

-- ============================================================
-- Machine capacity (parallel capacity + default changeover per machine/station/line)
-- ============================================================
CREATE TABLE IF NOT EXISTS machine_capacity (
  "id" serial PRIMARY KEY,
  "lineId" integer NOT NULL,
  "stationId" integer,
  "machineId" integer,
  "parallelCapacity" integer NOT NULL DEFAULT 1,
  "changeoverDefaultMin" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_machine_capacity_line ON machine_capacity ("lineId");
CREATE INDEX IF NOT EXISTS idx_machine_capacity_station ON machine_capacity ("stationId");
CREATE INDEX IF NOT EXISTS idx_machine_capacity_machine ON machine_capacity ("machineId");

-- ============================================================
-- schedule_run_items: APS placement columns (nullable, additive)
-- ============================================================
ALTER TABLE schedule_run_items ADD COLUMN IF NOT EXISTS "stationId" integer;
ALTER TABLE schedule_run_items ADD COLUMN IF NOT EXISTS "setupMinutes" integer;
ALTER TABLE schedule_run_items ADD COLUMN IF NOT EXISTS "sequenceIndex" integer;
