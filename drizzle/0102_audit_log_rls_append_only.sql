-- Migration: Audit log append-only protection via PostgreSQL Row-Level Security
-- Prevents any user (including DBA) from UPDATE/DELETE on audit_logs.
-- Required for: 21 CFR Part 11 §11.10(e), ISO 9001:2015 7.5.3, IATF 16949 record control.
--
-- NOTE: The application DB user must NOT be a superuser.
-- Superusers bypass RLS. Create a least-privilege app user:
--   CREATE ROLE avi_app LOGIN PASSWORD '...';
--   GRANT SELECT, INSERT ON audit_logs TO avi_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL OTHER TABLES TO avi_app;

-- Enable Row Level Security on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow INSERT for all authenticated roles (application writes new records)
CREATE POLICY audit_logs_insert_only
  ON audit_logs
  FOR INSERT
  TO PUBLIC
  WITH CHECK (true);

-- Allow SELECT for all authenticated roles (reading is fine)
CREATE POLICY audit_logs_select_only
  ON audit_logs
  FOR SELECT
  TO PUBLIC
  USING (true);

-- Explicitly DENY UPDATE and DELETE by NOT creating policies for them.
-- With RLS enabled, any operation not covered by a policy is denied by default.

-- ─── Enum extensions ─────────────────────────────────────────────────────────

-- Extend machineTypeEnum with SMT production line machine types
ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS 'SPI';
ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS 'AXI';
ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS 'ICT';
ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS 'FCT';
ALTER TYPE machinetypeenum ADD VALUE IF NOT EXISTS 'CMM';

-- Extend operationStatusEnum with line-balance states
ALTER TYPE operationstatusenum ADD VALUE IF NOT EXISTS 'warming_up';
ALTER TYPE operationstatusenum ADD VALUE IF NOT EXISTS 'changeover';
ALTER TYPE operationstatusenum ADD VALUE IF NOT EXISTS 'starved';
ALTER TYPE operationstatusenum ADD VALUE IF NOT EXISTS 'blocked';

-- ─── corporates table (new) ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corporates (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  country     VARCHAR(100),
  "contactEmail" VARCHAR(320),
  "logoUrl"   TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corporates_code   ON corporates (code);
CREATE INDEX IF NOT EXISTS idx_corporates_active ON corporates ("isActive");

-- ─── factories: add corporateCode and timezone ────────────────────────────────

ALTER TABLE factories
  ADD COLUMN IF NOT EXISTS "corporateCode" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS timezone        VARCHAR(64) DEFAULT 'Asia/Ho_Chi_Minh';

CREATE INDEX IF NOT EXISTS idx_factories_corporate ON factories ("corporateCode");

-- ─── measurementResults: defect bounding box ─────────────────────────────────

ALTER TABLE measurement_results
  ADD COLUMN IF NOT EXISTS "defectBboxX"   INTEGER,
  ADD COLUMN IF NOT EXISTS "defectBboxY"   INTEGER,
  ADD COLUMN IF NOT EXISTS "defectBboxW"   INTEGER,
  ADD COLUMN IF NOT EXISTS "defectBboxH"   INTEGER,
  ADD COLUMN IF NOT EXISTS "defectCropUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "defectCropKey" VARCHAR(255);

-- ─── userCorporateAssignments: enforce uniqueness ────────────────────────────

-- Drop old non-unique index if exists, create unique index
DROP INDEX IF EXISTS idx_user_corporate_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_corporate_unique
  ON user_corporate_assignments ("userId", "corporateCode");
