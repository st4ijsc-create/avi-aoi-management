-- ============================================================================
-- Migration 0094: P4.C G15 — Station triangulation links
-- Tracks the same physical unit (serialNumber) across SPI → AOI_PRE → REFLOW →
-- AOI_POST → AXI → ICT → FCT and reconciles which station first detected/escaped
-- a defect. Used for "process flow viewer" + escape-rate analytics.
-- ============================================================================

-- Per-serial cross-station summary. One row per serialNumber.
CREATE TABLE IF NOT EXISTS "station_traces" (
  "id" serial PRIMARY KEY,
  "serialNumber" varchar(128) NOT NULL,
  "productModelId" integer,
  "lotCode" varchar(80),
  "firstSeenAt" timestamp,
  "lastSeenAt" timestamp,
  "stationsTouched" text[],     -- array of station codes in order
  "firstDefectStation" varchar(50),
  "firstEscapeStation" varchar(50),  -- NG at downstream after OK upstream
  "totalDefects" integer NOT NULL DEFAULT 0,
  "totalEscapes" integer NOT NULL DEFAULT 0,
  "summary" jsonb,              -- per-station OK/NG counts + sample ids
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_station_traces_serial" UNIQUE ("serialNumber")
);

CREATE INDEX IF NOT EXISTS "idx_station_traces_product" ON "station_traces" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_station_traces_lot" ON "station_traces" ("lotCode");
CREATE INDEX IF NOT EXISTS "idx_station_traces_first_escape" ON "station_traces" ("firstEscapeStation");
CREATE INDEX IF NOT EXISTS "idx_station_traces_updated" ON "station_traces" ("updatedAt");
