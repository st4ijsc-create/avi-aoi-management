-- 0113 G3: Energy/Sustainability (G14), ML Feature Store & Inference Audit (ML-Ops), HA/DR verify-restore (G12)
-- Idempotent. Safe to re-run. KHÔNG tự động chạy — chạy thủ công khi sẵn sàng.

-- ============================================================
-- Enums (Giai đoạn 3)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE energysourceenum AS ENUM ('electricity','compressed_air','water','gas','steam','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE complianceviewenum AS ENUM ('CFR21_PART11','IATF16949','ISO9001','ISO17025','ISO50001');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE drcheckstatusenum AS ENUM ('passed','failed','skipped','running');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- G14 — Energy monitoring & EnPI (ISO 50001)
-- ============================================================
CREATE TABLE IF NOT EXISTS energy_readings (
  id SERIAL PRIMARY KEY,
  "machineId" INTEGER,
  "layoutId" INTEGER,
  source energysourceenum NOT NULL DEFAULT 'electricity',
  value DECIMAL(14,4) NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT 'kWh',
  "powerKw" DECIMAL(12,4),
  timestamp TIMESTAMP NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_energy_machine ON energy_readings ("machineId");
CREATE INDEX IF NOT EXISTS idx_energy_source ON energy_readings (source);
CREATE INDEX IF NOT EXISTS idx_energy_ts ON energy_readings (timestamp);

CREATE TABLE IF NOT EXISTS enpi_metrics (
  id SERIAL PRIMARY KEY,
  "machineId" INTEGER,
  "layoutId" INTEGER,
  "periodStart" TIMESTAMP NOT NULL,
  "periodEnd" TIMESTAMP NOT NULL,
  "totalKwh" DECIMAL(16,4) NOT NULL,
  "goodUnits" INTEGER NOT NULL DEFAULT 0,
  "energyPerUnit" DECIMAL(16,6),
  "baselineEnergyPerUnit" DECIMAL(16,6),
  "carbonKg" DECIMAL(16,4),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enpi_machine ON enpi_metrics ("machineId");
CREATE INDEX IF NOT EXISTS idx_enpi_period ON enpi_metrics ("periodStart");

-- ============================================================
-- ML-Ops — Feature store & inference audit
-- ============================================================
CREATE TABLE IF NOT EXISTS ml_feature_cache (
  id SERIAL PRIMARY KEY,
  "entityType" VARCHAR(64) NOT NULL,
  "entityId" VARCHAR(128) NOT NULL,
  "featureSet" VARCHAR(128) NOT NULL,
  features JSONB NOT NULL,
  "computedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mlfeat_entity ON ml_feature_cache ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mlfeat_set ON ml_feature_cache ("featureSet");
CREATE INDEX IF NOT EXISTS idx_mlfeat_expires ON ml_feature_cache ("expiresAt");

CREATE TABLE IF NOT EXISTS ml_inference_audit (
  id SERIAL PRIMARY KEY,
  "modelName" VARCHAR(128) NOT NULL,
  "modelVersion" VARCHAR(64),
  "entityType" VARCHAR(64),
  "entityId" VARCHAR(128),
  input JSONB,
  output JSONB,
  confidence DECIMAL(6,4),
  "latencyMs" INTEGER,
  "groundTruth" JSONB,
  "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mlaudit_model ON ml_inference_audit ("modelName");
CREATE INDEX IF NOT EXISTS idx_mlaudit_entity ON ml_inference_audit ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS idx_mlaudit_review ON ml_inference_audit ("flaggedForReview");
CREATE INDEX IF NOT EXISTS idx_mlaudit_created ON ml_inference_audit ("createdAt");

-- ============================================================
-- G12 — HA/DR verify-restore log
-- ============================================================
CREATE TABLE IF NOT EXISTS dr_restore_checks (
  id SERIAL PRIMARY KEY,
  "checkType" VARCHAR(64) NOT NULL DEFAULT 'verify_restore',
  status drcheckstatusenum NOT NULL DEFAULT 'running',
  "rpoSeconds" INTEGER,
  "rtoSeconds" INTEGER,
  "backupRef" VARCHAR(256),
  details TEXT,
  "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "finishedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drcheck_status ON dr_restore_checks (status);
CREATE INDEX IF NOT EXISTS idx_drcheck_started ON dr_restore_checks ("startedAt");
