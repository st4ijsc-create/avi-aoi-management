-- 0115 G2.4: BOM definitions + line items + feeder materials + component installations
-- Additive ONLY. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS). KHÔNG ALTER/DROP bảng cũ,
-- KHÔNG tạo enum mới cho status (status là varchar).
-- Ngoại lệ DUY NHẤT: thêm 1 giá trị 'mes_bom' vào permissioncategoryenum sẵn có
-- (RBAC category). ADD VALUE là thao tác ADDITIVE thuần (như F4a 'machine_control',
-- F5a 'andon'/'interlock') — KHÔNG sửa/đổi dữ liệu bảng nào. Safe to re-run.

-- ============================================================
-- RBAC category (additive enum value for the existing permissions.category enum)
-- ============================================================
ALTER TYPE "permissioncategoryenum" ADD VALUE IF NOT EXISTS 'mes_bom';

-- ============================================================
-- BOM definitions (versioned per product model)
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_definitions (
  "id" serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "code" varchar(100) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "name" varchar(255),
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "notes" text,
  "createdBy" integer,
  "isActive" boolean NOT NULL DEFAULT true,
  "deletedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bomdef_model_code_version ON bom_definitions ("productModelId", "code", "version");
CREATE INDEX IF NOT EXISTS idx_bomdef_model ON bom_definitions ("productModelId");
CREATE INDEX IF NOT EXISTS idx_bomdef_status ON bom_definitions ("status");
CREATE INDEX IF NOT EXISTS idx_bomdef_deleted ON bom_definitions ("deletedAt");

-- ============================================================
-- BOM line items
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_line_items (
  "id" serial PRIMARY KEY,
  "bomId" integer NOT NULL,
  "componentCode" varchar(100) NOT NULL,
  "componentName" varchar(255),
  "qtyPer" numeric(14,4) NOT NULL,
  "unit" varchar(16) NOT NULL DEFAULT 'pcs',
  "refDesignator" varchar(255),
  "alternateGroup" varchar(64),
  "isOptional" boolean NOT NULL DEFAULT false,
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bomline_bom ON bom_line_items ("bomId");
CREATE INDEX IF NOT EXISTS idx_bomline_component ON bom_line_items ("componentCode");

-- ============================================================
-- Feeder materials (loaded onto a machine slot; consumed on install)
-- ============================================================
CREATE TABLE IF NOT EXISTS feeder_materials (
  "id" serial PRIMARY KEY,
  "machineId" integer NOT NULL,
  "slotCode" varchar(40),
  "componentCode" varchar(100) NOT NULL,
  "supplierLotId" integer,
  "qtyOnFeeder" numeric(14,3) NOT NULL DEFAULT 0,
  "consumptionRatePerHour" numeric(14,3),
  "reorderLevel" numeric(14,3) NOT NULL DEFAULT 0,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "loadedAt" timestamp,
  "loadedBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feeder_machine ON feeder_materials ("machineId");
CREATE INDEX IF NOT EXISTS idx_feeder_component ON feeder_materials ("componentCode");
CREATE INDEX IF NOT EXISTS idx_feeder_suplot ON feeder_materials ("supplierLotId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_feeder_machine_slot ON feeder_materials ("machineId", "slotCode") WHERE "slotCode" IS NOT NULL;

-- ============================================================
-- Component installations (component → serial genealogy, telemetry)
-- ============================================================
CREATE TABLE IF NOT EXISTS component_installations (
  "id" serial PRIMARY KEY,
  "serialNumber" varchar(128) NOT NULL,
  "componentCode" varchar(100) NOT NULL,
  "componentSerial" varchar(128),
  "supplierLotId" integer,
  "feederMaterialId" integer,
  "machineId" integer,
  "bomLineItemId" integer,
  "qty" numeric(14,4) NOT NULL DEFAULT 1,
  "refDesignator" varchar(120),
  "genealogyHash" varchar(64),
  "installedAt" timestamp NOT NULL DEFAULT now(),
  "installedBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compinst_serial ON component_installations ("serialNumber");
CREATE INDEX IF NOT EXISTS idx_compinst_component ON component_installations ("componentCode");
CREATE INDEX IF NOT EXISTS idx_compinst_suplot ON component_installations ("supplierLotId");
CREATE INDEX IF NOT EXISTS idx_compinst_machine ON component_installations ("machineId");
CREATE INDEX IF NOT EXISTS idx_compinst_genhash ON component_installations ("genealogyHash");
