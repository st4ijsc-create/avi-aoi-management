-- 0112 G2: MES / WIP / Traceability / Predictive Maintenance (GAP G5/G6/G7)
-- Idempotent. Safe to re-run. KHÔNG tự động chạy — chạy thủ công khi sẵn sàng.

-- ============================================================
-- Enums (Giai đoạn 2)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE wipstatusenum AS ENUM ('queued','in_process','waiting','completed','hold','scrapped','reworked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lotdispositionenum AS ENUM ('release','rework','scrap','return','hold','quarantine');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE supplierlotstatusenum AS ENUM ('received','inspecting','approved','rejected','consumed','returned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE maintenancescheduletypeenum AS ENUM ('TIME_BASED','USAGE_BASED','CONDITION_BASED','PREDICTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workorderstatusenum AS ENUM ('OPEN','SCHEDULED','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workordertypeenum AS ENUM ('PREVENTIVE','PREDICTIVE','CORRECTIVE','BREAKDOWN','INSPECTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workordertriggerenum AS ENUM ('MANUAL','SCHEDULE','PREDICTED_FAILURE','HEALTH_SCORE','SENSOR_ALERT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- G5 — WIP & Material Flow
-- ============================================================
CREATE TABLE IF NOT EXISTS wip_tracking (
  "id" serial PRIMARY KEY,
  "serialNumber" varchar(128),
  "lotNumber" varchar(128),
  "productId" integer,
  "productCode" varchar(64),
  "workOrderNumber" varchar(64),
  "lineId" integer,
  "currentStationId" integer,
  "currentMachineId" integer,
  "status" wipstatusenum NOT NULL DEFAULT 'queued',
  "quantity" integer NOT NULL DEFAULT 1,
  "enteredAt" timestamp NOT NULL DEFAULT now(),
  "exitedAt" timestamp,
  "parentSerialNumber" varchar(128),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wip_serial ON wip_tracking ("serialNumber");
CREATE INDEX IF NOT EXISTS idx_wip_lot ON wip_tracking ("lotNumber");
CREATE INDEX IF NOT EXISTS idx_wip_line ON wip_tracking ("lineId");
CREATE INDEX IF NOT EXISTS idx_wip_station ON wip_tracking ("currentStationId");
CREATE INDEX IF NOT EXISTS idx_wip_status ON wip_tracking ("status");
CREATE INDEX IF NOT EXISTS idx_wip_entered ON wip_tracking ("enteredAt");

CREATE TABLE IF NOT EXISTS station_dwell_time (
  "id" serial PRIMARY KEY,
  "lineId" integer,
  "stationId" integer NOT NULL,
  "machineId" integer,
  "serialNumber" varchar(128),
  "lotNumber" varchar(128),
  "dwellMs" integer NOT NULL DEFAULT 0,
  "processingMs" integer NOT NULL DEFAULT 0,
  "starvedMs" integer NOT NULL DEFAULT 0,
  "blockedMs" integer NOT NULL DEFAULT 0,
  "enteredAt" timestamp NOT NULL DEFAULT now(),
  "exitedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dwell_station ON station_dwell_time ("stationId");
CREATE INDEX IF NOT EXISTS idx_dwell_line ON station_dwell_time ("lineId");
CREATE INDEX IF NOT EXISTS idx_dwell_machine ON station_dwell_time ("machineId");
CREATE INDEX IF NOT EXISTS idx_dwell_entered ON station_dwell_time ("enteredAt");

CREATE TABLE IF NOT EXISTS line_balance_metrics (
  "id" serial PRIMARY KEY,
  "lineId" integer NOT NULL,
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "taktTimeMs" integer,
  "avgCycleTimeMs" integer,
  "maxCycleTimeMs" integer,
  "bottleneckStationId" integer,
  "bottleneckMachineId" integer,
  "utilizationPct" numeric(5,2),
  "balanceRatePct" numeric(5,2),
  "throughputUnits" integer NOT NULL DEFAULT 0,
  "wipCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_linebal_line ON line_balance_metrics ("lineId");
CREATE INDEX IF NOT EXISTS idx_linebal_period ON line_balance_metrics ("periodStart");

-- ============================================================
-- G6 — Material Traceability
-- ============================================================
CREATE TABLE IF NOT EXISTS material_receipts (
  "id" serial PRIMARY KEY,
  "receiptNumber" varchar(64) NOT NULL UNIQUE,
  "supplierName" varchar(256),
  "supplierCode" varchar(64),
  "materialCode" varchar(64) NOT NULL,
  "materialName" varchar(256),
  "quantity" numeric(14,3) NOT NULL,
  "unit" varchar(16) NOT NULL DEFAULT 'pcs',
  "receivedDate" timestamp NOT NULL DEFAULT now(),
  "poNumber" varchar(64),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matrecv_supplier ON material_receipts ("supplierCode");
CREATE INDEX IF NOT EXISTS idx_matrecv_material ON material_receipts ("materialCode");
CREATE INDEX IF NOT EXISTS idx_matrecv_date ON material_receipts ("receivedDate");

CREATE TABLE IF NOT EXISTS supplier_lots (
  "id" serial PRIMARY KEY,
  "supplierLotNumber" varchar(128) NOT NULL,
  "receiptId" integer,
  "materialCode" varchar(64) NOT NULL,
  "materialName" varchar(256),
  "quantity" numeric(14,3) NOT NULL,
  "remainingQuantity" numeric(14,3),
  "unit" varchar(16) NOT NULL DEFAULT 'pcs',
  "status" supplierlotstatusenum NOT NULL DEFAULT 'received',
  "expiryDate" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suplot_number ON supplier_lots ("supplierLotNumber");
CREATE INDEX IF NOT EXISTS idx_suplot_receipt ON supplier_lots ("receiptId");
CREATE INDEX IF NOT EXISTS idx_suplot_material ON supplier_lots ("materialCode");
CREATE INDEX IF NOT EXISTS idx_suplot_status ON supplier_lots ("status");

CREATE TABLE IF NOT EXISTS lot_disposition (
  "id" serial PRIMARY KEY,
  "lotNumber" varchar(128) NOT NULL,
  "supplierLotId" integer,
  "serialNumber" varchar(128),
  "disposition" lotdispositionenum NOT NULL,
  "quantity" numeric(14,3) NOT NULL,
  "reason" text,
  "defectCode" varchar(64),
  "decidedBy" integer,
  "decidedAt" timestamp NOT NULL DEFAULT now(),
  "customerReturnRef" varchar(128),
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lotdisp_lot ON lot_disposition ("lotNumber");
CREATE INDEX IF NOT EXISTS idx_lotdisp_suplot ON lot_disposition ("supplierLotId");
CREATE INDEX IF NOT EXISTS idx_lotdisp_serial ON lot_disposition ("serialNumber");
CREATE INDEX IF NOT EXISTS idx_lotdisp_type ON lot_disposition ("disposition");

-- ============================================================
-- G7 — Predictive Maintenance closed-loop
-- ============================================================
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL,
  "machineCode" varchar(64),
  "scheduleType" maintenancescheduletypeenum NOT NULL DEFAULT 'TIME_BASED',
  "taskName" varchar(256) NOT NULL,
  "description" text,
  "intervalDays" integer,
  "intervalUsageHours" integer,
  "lastPerformedAt" timestamp,
  "nextDueAt" timestamp,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msched_machine ON maintenance_schedules ("machineId");
CREATE INDEX IF NOT EXISTS idx_msched_due ON maintenance_schedules ("nextDueAt");
CREATE INDEX IF NOT EXISTS idx_msched_active ON maintenance_schedules ("isActive");

CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  "id" serial PRIMARY KEY,
  "workOrderNumber" varchar(64) NOT NULL UNIQUE,
  "machineId" integer NOT NULL,
  "machineCode" varchar(64),
  "scheduleId" integer,
  "type" workordertypeenum NOT NULL DEFAULT 'CORRECTIVE',
  "status" workorderstatusenum NOT NULL DEFAULT 'OPEN',
  "trigger" workordertriggerenum NOT NULL DEFAULT 'MANUAL',
  "predictedFailureRisk" integer,
  "healthScore" integer,
  "priority" integer NOT NULL DEFAULT 3,
  "title" varchar(256) NOT NULL,
  "description" text,
  "assignedTo" integer,
  "openedAt" timestamp NOT NULL DEFAULT now(),
  "scheduledFor" timestamp,
  "repairStartedAt" timestamp,
  "closedAt" timestamp,
  "downtimeMinutes" integer,
  "resolutionNotes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wo_machine ON maintenance_work_orders ("machineId");
CREATE INDEX IF NOT EXISTS idx_wo_status ON maintenance_work_orders ("status");
CREATE INDEX IF NOT EXISTS idx_wo_type ON maintenance_work_orders ("type");
CREATE INDEX IF NOT EXISTS idx_wo_trigger ON maintenance_work_orders ("trigger");
CREATE INDEX IF NOT EXISTS idx_wo_opened ON maintenance_work_orders ("openedAt");

CREATE TABLE IF NOT EXISTS spare_parts_inventory (
  "id" serial PRIMARY KEY,
  "partCode" varchar(64) NOT NULL UNIQUE,
  "partName" varchar(256) NOT NULL,
  "category" varchar(64),
  "quantityOnHand" integer NOT NULL DEFAULT 0,
  "reorderLevel" integer NOT NULL DEFAULT 0,
  "reorderQuantity" integer NOT NULL DEFAULT 0,
  "unit" varchar(16) NOT NULL DEFAULT 'pcs',
  "location" varchar(128),
  "unitCost" numeric(14,2),
  "supplierCode" varchar(64),
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spare_code ON spare_parts_inventory ("partCode");
CREATE INDEX IF NOT EXISTS idx_spare_category ON spare_parts_inventory ("category");

CREATE TABLE IF NOT EXISTS pm_effectiveness_metrics (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL,
  "machineCode" varchar(64),
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "mttrMinutes" numeric(12,2),
  "mtbfHours" numeric(12,2),
  "failureCount" integer NOT NULL DEFAULT 0,
  "workOrderCount" integer NOT NULL DEFAULT 0,
  "pmCompliancePct" numeric(5,2),
  "plannedDowntimeMinutes" integer NOT NULL DEFAULT 0,
  "unplannedDowntimeMinutes" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pmeff_machine ON pm_effectiveness_metrics ("machineId");
CREATE INDEX IF NOT EXISTS idx_pmeff_period ON pm_effectiveness_metrics ("periodStart");
