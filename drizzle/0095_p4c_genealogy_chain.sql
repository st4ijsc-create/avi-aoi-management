-- ============================================================================
-- Migration 0095: P4.C G11 — Genealogy hash-chain
-- Append-only ledger of unit / lot / station events. Each row stores the
-- SHA-256 of the canonical JSON of the previous row, providing a tamper-
-- evident chain for audit and recall investigations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "genealogy_chain" (
  "id" serial PRIMARY KEY,
  "prevHash" varchar(64) NOT NULL,
  "currHash" varchar(64) NOT NULL,
  "serialNumber" varchar(128) NOT NULL,
  "parentSerial" varchar(128),
  "eventType" varchar(40) NOT NULL,    -- e.g. born / station / merge / split / scrap / ship
  "stationCode" varchar(50),
  "lotCode" varchar(80),
  "productModelId" integer,
  "payload" jsonb NOT NULL,
  "recordedBy" integer,
  "recordedAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_genealogy_chain_curr_hash" UNIQUE ("currHash")
);

CREATE INDEX IF NOT EXISTS "idx_genealogy_chain_serial"   ON "genealogy_chain" ("serialNumber");
CREATE INDEX IF NOT EXISTS "idx_genealogy_chain_parent"   ON "genealogy_chain" ("parentSerial");
CREATE INDEX IF NOT EXISTS "idx_genealogy_chain_lot"      ON "genealogy_chain" ("lotCode");
CREATE INDEX IF NOT EXISTS "idx_genealogy_chain_recorded" ON "genealogy_chain" ("recordedAt");
