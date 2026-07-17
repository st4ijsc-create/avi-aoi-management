-- ============================================================================
-- Migration 0293: MACHINE CONFIG SHADOW (doc 56 Đ4 — CONFIG-SYNC-1/2/3/6).
--
-- ONE generic "digital shadow" row per (machineId, configKind) that carries what a
-- machine is SUPPOSED to run (desired*, set at deploy/notify) vs what it REPORTS
-- running (reported*, set at ackConfigApplied / heartbeat drift). driftState
-- summarises the two (in_sync | drift | unknown).
--
--   configKind — free varchar (NOT a pg enum; repo convention grows catalogs by ROW):
--     'recipe' | 'device_settings' | 'points' | 'model' today, extensible w/o a mig.
--   desired/reported version+checksum — varchar so ANY config family's version
--     representation fits (recipe int, points int, model semver). checksum is the
--     authoritative drift signal, version is context.
--
-- WRITTEN BY NOTHING until CONFIG_SYNC_GENERIC_ENABLED / CONFIG_DRIFT_REPORT_ENABLED
-- (default OFF) are flipped ON → this table is inert on apply (safe to ship dark).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE IF NOT EXISTS; unique + indexes IF NOT EXISTS.
-- ROLLBACK: DROP TABLE IF EXISTS "machine_config_state";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "machine_config_state" (
  "id"              serial PRIMARY KEY,
  "machineId"       integer NOT NULL,
  "configKind"      varchar(32) NOT NULL,
  "desiredCode"     varchar(128),
  "desiredVersion"  varchar(64),
  "desiredChecksum" varchar(128),
  "notifiedAt"      timestamp,
  "reportedCode"    varchar(128),
  "reportedVersion" varchar(64),
  "reportedChecksum" varchar(128),
  "reportedAt"      timestamp,
  "driftState"      varchar(16) NOT NULL DEFAULT 'unknown',
  "createdAt"       timestamp NOT NULL DEFAULT now(),
  "updatedAt"       timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

-- One shadow row per (machine, configKind) — the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_machine_config_state"
  ON "machine_config_state" ("machineId","configKind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_config_state_machine"
  ON "machine_config_state" ("machineId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_machine_config_state_drift"
  ON "machine_config_state" ("driftState");
