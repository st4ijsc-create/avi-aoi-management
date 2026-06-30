-- ============================================================================
-- 0132 — Unified canonical telemetry store (doc 12 §5 / P2).
--
-- ONE table, `ot_telemetry`, that EVERY device protocol (MQTT / OPC-UA / Modbus /
-- S7 / EtherNet-IP / MTConnect / Sparkplug) and the inspection pipeline writes
-- its normalized samples into — replacing the old per-protocol / per-adapter
-- silo shape. One row = one (ts, machine/device, metric) observation.
--
-- The pre-existing ot_telemetry (adapterId/tagKey/valueNumeric/valueText/
-- timestamp) is EMPTY (0 rows), so we DROP + CREATE to the clean canonical
-- structure rather than carry forward a dozen ALTERs. Idempotent & safe to
-- re-run (DROP ... IF EXISTS, CREATE TYPE guarded, CREATE INDEX IF NOT EXISTS).
--
-- TIMESCALE-READY but NOT YET a hypertable: this is a plain regular table. We do
-- NOT use native declarative partitioning here — it would conflict with the
-- deferred TimescaleDB hypertable conversion in 0133. The operator applies 0133
-- (hypertable + continuous aggregates + compression/retention) once the
-- timescaledb extension is installed on the server.
-- ============================================================================

-- ── Enums (append-only; guarded so re-run is a no-op) ───────────────────────
DO $$ BEGIN
  CREATE TYPE "telemetryprotocolenum" AS ENUM
    ('mqtt','opcua','modbus','s7','ethernet_ip','mtconnect','sparkplug','inspection','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "telemetryqualityenum" AS ENUM ('good','bad','uncertain');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Recreate ot_telemetry in the canonical shape (table is empty) ───────────
DROP TABLE IF EXISTS "ot_telemetry";

CREATE TABLE "ot_telemetry" (
  "id"          bigserial PRIMARY KEY,
  "ts"          timestamptz NOT NULL,                 -- event time (source timestamp)
  "machineId"   integer,                              -- soft ref to machines.id (no FK; nullable)
  "deviceId"    text,                                 -- external/source device identifier
  "protocol"    "telemetryprotocolenum" NOT NULL,
  "metric"      text NOT NULL,                        -- normalized tag/metric name
  "numValue"    double precision,
  "textValue"   text,
  "boolValue"   boolean,
  "unit"        text,
  "quality"     "telemetryqualityenum" NOT NULL DEFAULT 'good',
  "meta"        jsonb,                                -- raw payload / extra fields
  "ingestedAt"  timestamptz NOT NULL DEFAULT now()    -- server receive time
);

COMMENT ON TABLE "ot_telemetry" IS
  'Unified canonical telemetry sample store (doc 12 P2). All device protocols + inspection write here. Timescale-READY; converted to a hypertable by deferred migration 0133 once timescaledb is installed.';

-- ── Indexes for high-volume read patterns ───────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_ot_telemetry_machine_ts"  ON "ot_telemetry" ("machineId", "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_ot_telemetry_metric_ts"   ON "ot_telemetry" ("metric",    "ts" DESC);
CREATE INDEX IF NOT EXISTS "idx_ot_telemetry_protocol_ts" ON "ot_telemetry" ("protocol",  "ts" DESC);
