-- Doc 27 Đợt 2 / W2-C — per-machine credentials + MQTT password hash-at-rest
-- (gaps C7 P1, R12 P3). ADDITIVE ONLY: extends the EXISTING api_keys table from
-- migration 0126 (per the audit note "0126 exists for API keys — extend to
-- machines") instead of creating a duplicate machine_api_keys table, and adds
-- the per-device password columns mqtt_clients never actually had (the
-- mqttService password check read a column that did not exist → it silently
-- never enforced).

-- ── api_keys: machine binding + revocation audit ─────────────────────────────
-- machineId: soft-ref → machines.id (repo convention: master-data FKs are batch
-- work in Đợt 3 / gap M1 — do not add a hard FK here out of band).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "machineId" integer;
-- revokedAt: audit stamp; enforcement remains isActive=false (both are denied).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "revokedAt" timestamp;
CREATE INDEX IF NOT EXISTS "idx_api_keys_machine" ON "api_keys" ("machineId");

-- ── product_inspections: SOFT commissioning-gate tag (W2-D seam, gap C4/M8) ──
-- "commissioning" = the machine had NO signed aoi_commissioning_records row at
-- ingest time — the submission is accepted but TAGGED (never rejected).
-- NULL = production/default. Works on plain tables and Timescale hypertables.
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "ingestMode" varchar(20);

-- ── mqtt_clients: per-device password, hash at rest ──────────────────────────
-- passwordHash (bcrypt) is the credential the broker verifies against when
-- MQTT_REQUIRE_PASSWORD=true. password is a LEGACY plaintext staging column:
-- ops may set it once; on the device's next successful connect mqttService
-- upgrades it into passwordHash and clears the plaintext (upgrade-in-place).
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "password" varchar(255);
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "passwordHash" varchar(255);
