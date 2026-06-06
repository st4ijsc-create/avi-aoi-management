-- ============================================================================
-- Migration 0090: P4.A G19 — Instrument calibration & MSA lifecycle gate
-- Tables:
--   instrument_calibrations  — append-only certificate log with traceability
--   instrument_msa_records   — MSA history (link to msa_studies; expiry tracking)
-- Plus a simple status view for "instrument health".
-- All additive, idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) instrument_calibrations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "instrument_calibrations" (
  "id" serial PRIMARY KEY,
  "instrumentId" integer NOT NULL,
  "certNumber" varchar(120) NOT NULL,
  "certPdfUrl" text,
  "certPdfKey" varchar(255),
  -- ISO/IEC 17025 traceability chain (e.g. "NIST", "VMI", "PJLA")
  "traceability" varchar(80),
  "performedAt" timestamp NOT NULL,
  "validUntil" timestamp NOT NULL,
  "performedBy" varchar(255),
  "performedByOrg" varchar(255),
  -- standard reference used (master gauge id / serial)
  "referenceStandard" varchar(255),
  -- as-found / as-left bias (optional, for full ISO compliance)
  "asFoundBias" numeric(15, 6),
  "asLeftBias" numeric(15, 6),
  "uncertainty" numeric(15, 6),
  -- Result: pass | conditional | fail
  "result" varchar(20) NOT NULL DEFAULT 'pass',
  "notes" text,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "deletedAt" timestamp,
  CONSTRAINT "chk_instrument_calibrations_result"
    CHECK ("result" IN ('pass','conditional','fail'))
);

CREATE INDEX IF NOT EXISTS "idx_instr_cal_instrument" ON "instrument_calibrations" ("instrumentId");
CREATE INDEX IF NOT EXISTS "idx_instr_cal_valid_until" ON "instrument_calibrations" ("validUntil");
CREATE INDEX IF NOT EXISTS "idx_instr_cal_performed_at" ON "instrument_calibrations" ("performedAt");
CREATE INDEX IF NOT EXISTS "idx_instr_cal_deleted_at" ON "instrument_calibrations" ("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_instr_cal_cert"
  ON "instrument_calibrations" ("instrumentId","certNumber")
  WHERE "deletedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_instrument_calibrations_instrument'
  ) THEN
    ALTER TABLE "instrument_calibrations"
      ADD CONSTRAINT "fk_instrument_calibrations_instrument"
      FOREIGN KEY ("instrumentId") REFERENCES "measurement_instruments" ("id");
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) instrument_msa_records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "instrument_msa_records" (
  "id" serial PRIMARY KEY,
  "instrumentId" integer NOT NULL,
  -- Link to msa_studies row (nullable, for ad-hoc records).
  "msaStudyId" integer,
  -- Method: ARM (Average-Range Method) | ANOVA | BIAS | LINEARITY | STABILITY
  "method" varchar(20) NOT NULL DEFAULT 'ARM',
  "performedAt" timestamp NOT NULL DEFAULT NOW(),
  "validUntil" timestamp NOT NULL,
  -- Key MSA metrics (from AIAG MSA 4th ed.)
  "evPct" numeric(8, 4),       -- Equipment Variation %
  "avPct" numeric(8, 4),       -- Appraiser Variation %
  "grrPct" numeric(8, 4),      -- Gauge R&R %
  "ndc" integer,               -- Number of Distinct Categories (target ≥ 5)
  "ptRatio" numeric(8, 4),     -- Precision-to-Tolerance ratio
  "biasValue" numeric(15, 6),  -- For BIAS method
  "linearityScore" numeric(8, 4), -- For LINEARITY method
  "stabilityScore" numeric(8, 4), -- For STABILITY method
  -- Verdict: good (<10%), acceptable (10-30%), poor (>30%)
  "verdict" varchar(20) NOT NULL DEFAULT 'unknown',
  "approvedBy" integer,
  "approvedAt" timestamp,
  "notes" text,
  "reportPdfUrl" text,
  "reportPdfKey" varchar(255),
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "deletedAt" timestamp,
  CONSTRAINT "chk_instrument_msa_method"
    CHECK ("method" IN ('ARM','ANOVA','BIAS','LINEARITY','STABILITY')),
  CONSTRAINT "chk_instrument_msa_verdict"
    CHECK ("verdict" IN ('good','acceptable','poor','unknown'))
);

CREATE INDEX IF NOT EXISTS "idx_instr_msa_instrument" ON "instrument_msa_records" ("instrumentId");
CREATE INDEX IF NOT EXISTS "idx_instr_msa_valid_until" ON "instrument_msa_records" ("validUntil");
CREATE INDEX IF NOT EXISTS "idx_instr_msa_study" ON "instrument_msa_records" ("msaStudyId");
CREATE INDEX IF NOT EXISTS "idx_instr_msa_deleted_at" ON "instrument_msa_records" ("deletedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_instrument_msa_instrument'
  ) THEN
    ALTER TABLE "instrument_msa_records"
      ADD CONSTRAINT "fk_instrument_msa_instrument"
      FOREIGN KEY ("instrumentId") REFERENCES "measurement_instruments" ("id");
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Helper view: instrument_health_status (RAG flag for dashboard)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW "instrument_health_status" AS
SELECT
  i."id" AS "instrumentId",
  i."code",
  i."name",
  i."instrumentType",
  i."isActive",
  i."nextCalibrationAt",
  (SELECT MAX(c."validUntil") FROM "instrument_calibrations" c
     WHERE c."instrumentId" = i."id" AND c."deletedAt" IS NULL AND c."result" != 'fail')
    AS "lastCalValidUntil",
  (SELECT MAX(m."validUntil") FROM "instrument_msa_records" m
     WHERE m."instrumentId" = i."id" AND m."deletedAt" IS NULL AND m."verdict" IN ('good','acceptable'))
    AS "lastMsaValidUntil",
  CASE
    WHEN i."isActive" = false THEN 'inactive'
    WHEN COALESCE(
      (SELECT MAX(c."validUntil") FROM "instrument_calibrations" c
         WHERE c."instrumentId" = i."id" AND c."deletedAt" IS NULL AND c."result" != 'fail'),
      i."nextCalibrationAt"
    ) < NOW() THEN 'cal_expired'
    WHEN COALESCE(
      (SELECT MAX(c."validUntil") FROM "instrument_calibrations" c
         WHERE c."instrumentId" = i."id" AND c."deletedAt" IS NULL AND c."result" != 'fail'),
      i."nextCalibrationAt"
    ) < NOW() + INTERVAL '14 days' THEN 'cal_due_soon'
    WHEN (SELECT MAX(m."validUntil") FROM "instrument_msa_records" m
            WHERE m."instrumentId" = i."id" AND m."deletedAt" IS NULL AND m."verdict" IN ('good','acceptable'))
         IS NULL THEN 'msa_missing'
    WHEN (SELECT MAX(m."validUntil") FROM "instrument_msa_records" m
            WHERE m."instrumentId" = i."id" AND m."deletedAt" IS NULL AND m."verdict" IN ('good','acceptable'))
         < NOW() THEN 'msa_expired'
    ELSE 'ok'
  END AS "status"
FROM "measurement_instruments" i
WHERE i."deletedAt" IS NULL;
