-- ============================================================================
-- Migration 0192: Panel/Board multi-up master + Operator/Badge master
-- (doc 29 §2 + §3 — doc 27 §2 gaps M12b/M14; agent W8-B, Đợt 8).
--
-- WHAT:
--   1. product_panel_defs / product_panel_boards — N-up panel description of a
--      product model (rows×cols, panel dims, per-board offset/rotation/mirror/
--      X-out). Soft refs (no FK) per the inspection-domain convention.
--   2. operator_badges — badgeCode → users.id with a validity window (badge can
--      be re-issued over time). ONE active row per badgeCode (partial unique).
--      Backfilled from DISTINCT product_inspections.operatorId as 'auto_seen'.
--   3. product_inspections + panelSerial/boardIndex/operatorUserId — the ONE
--      hypertable-column migration doc 29 §5 planned (programReleaseId already
--      landed in 0187). product_inspections is a TimescaleDB hypertable (0172):
--      plain NULLABLE ADD COLUMN with no DEFAULT is metadata-only (no chunk
--      rewrite) — safe. NO backfill on the hypertable (doc 29 §2.3 rule).
--
-- SOFT REFERENCES (deliberate, mirrors 0182/0183/0187): no FKs — app-validated
-- + weekly integrity orphan scan; also FKs *to* a hypertable are impossible.
--
-- Idempotent / re-runnable: IF NOT EXISTS everywhere; backfill is WHERE NOT
-- EXISTS. Applied by scripts/apply-migration-0192.mjs (__applied_migrations).
-- ============================================================================

-- ── 1. Panel multi-up master ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "product_panel_defs" (
  "id" SERIAL PRIMARY KEY,
  "productModelId" INTEGER NOT NULL,
  "code" VARCHAR(60) NOT NULL,
  "name" VARCHAR(255),
  "rows" INTEGER NOT NULL DEFAULT 1,
  "cols" INTEGER NOT NULL DEFAULT 1,
  "nUp" INTEGER NOT NULL,
  "panelWidthMm" NUMERIC(10,3),
  "panelHeightMm" NUMERIC(10,3),
  "boardWidthMm" NUMERIC(10,3),
  "boardHeightMm" NUMERIC(10,3),
  "originCorner" VARCHAR(20) DEFAULT 'top_left',
  "serialScheme" VARCHAR(30) DEFAULT 'suffix',
  "fiducials" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_panel_defs_product"
  ON "product_panel_defs" ("productModelId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_panel_defs_product_code_version"
  ON "product_panel_defs" ("productModelId", "code", "version");

CREATE TABLE IF NOT EXISTS "product_panel_boards" (
  "id" SERIAL PRIMARY KEY,
  "panelDefId" INTEGER NOT NULL,
  "boardIndex" INTEGER NOT NULL,
  "offsetXMm" NUMERIC(10,3) NOT NULL,
  "offsetYMm" NUMERIC(10,3) NOT NULL,
  "rotationDeg" NUMERIC(6,2) NOT NULL DEFAULT 0,
  "mirrored" BOOLEAN NOT NULL DEFAULT false,
  "skipped" BOOLEAN NOT NULL DEFAULT false,
  "refDesPrefix" VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS "idx_panel_boards_def"
  ON "product_panel_boards" ("panelDefId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_panel_boards_def_index"
  ON "product_panel_boards" ("panelDefId", "boardIndex");

-- ── 2. Operator / Badge master ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "operator_badges" (
  "id" SERIAL PRIMARY KEY,
  "badgeCode" VARCHAR(50) NOT NULL,
  "userId" INTEGER,
  "displayName" VARCHAR(255),
  "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
  "validFrom" TIMESTAMP,
  "validTo" TIMESTAMP,
  "issuedBy" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_operator_badges_code"
  ON "operator_badges" ("badgeCode");
CREATE INDEX IF NOT EXISTS "idx_operator_badges_user"
  ON "operator_badges" ("userId");
-- One ACTIVE row per badge code (historical/revoked rows keep the code for
-- time-windowed resolution).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_operator_badges_code_active"
  ON "operator_badges" ("badgeCode") WHERE "isActive" = true;

-- Backfill (doc 29 §3.3 step 1): register every badge code ever seen on ingest
-- as an UNASSIGNED auto_seen badge — the admin page surfaces these for mapping.
-- Reads the hypertable once; writes ONLY the new plain table. Idempotent.
INSERT INTO "operator_badges" ("badgeCode", "source", "isActive")
SELECT DISTINCT pi."operatorId", 'auto_seen', true
FROM "product_inspections" pi
WHERE pi."operatorId" IS NOT NULL
  AND btrim(pi."operatorId") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "operator_badges" ob WHERE ob."badgeCode" = pi."operatorId"
  );

-- ── 3. Hypertable metadata-only columns (NULLABLE, no DEFAULT — no rewrite) ──

ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "panelSerial" VARCHAR(100);
ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "boardIndex" INTEGER;
ALTER TABLE "product_inspections"
  ADD COLUMN IF NOT EXISTS "operatorUserId" INTEGER;

-- Sparse partial indexes (columns stay NULL until panel/badge adoption).
CREATE INDEX IF NOT EXISTS "idx_inspections_board_index"
  ON "product_inspections" ("boardIndex")
  WHERE "boardIndex" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_inspections_operator_user"
  ON "product_inspections" ("operatorUserId")
  WHERE "operatorUserId" IS NOT NULL;

COMMENT ON COLUMN "product_inspections"."operatorId" IS
  'Doc 29 §3.2 (0192): BADGE CODE the machine sends (operator_badges.badgeCode) — NOT a users.id. Resolve via operatorBadgeService (time-windowed) or the stamped operatorUserId.';
COMMENT ON COLUMN "product_inspections"."panelSerial" IS
  'Doc 29 §2.3 (0192): machine-reported panel serial/identifier (st4i header panel_id). NULL = single-board / legacy ingest.';
COMMENT ON COLUMN "product_inspections"."boardIndex" IS
  'Doc 29 §2.3 (0192): 1-based board index inside the panel (product_panel_boards.boardIndex). NULL = single-board / legacy; queries use COALESCE(boardIndex, 1).';
COMMENT ON COLUMN "product_inspections"."operatorUserId" IS
  'Doc 29 §3.2 (0192): users.id resolved from operatorId (badge code) at ingest, fail-open NULL. Soft ref; old rows resolve on read.';
