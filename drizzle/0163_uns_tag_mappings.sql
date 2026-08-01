-- ============================================================================
-- Migration 0163: No-code Tag → UNS mapping designer (doc 24 — Connectivity)
--
-- Adds the `uns_tag_mappings` table backing a HighByte-style "Intelligence Hub":
-- map a raw OT adapter tag → an ISA-95 UNS topic + a Sparkplug metric name, with
-- per-tag CONDITIONING (rename, scale, offset, unit, cast, deadband) configured in
-- the UI instead of in code.
--
-- SAFETY / SCOPE: READ-DIRECTION publish concern ONLY. It reshapes how a telemetry
-- sample is PUBLISHED to the UNS. It opens NO control path and does NOT touch the
-- inbound NCMD/DCMD → commandDispatcher safety. It is consulted at publish time ONLY
-- when UNS_MAPPING_ENABLED === "true" (default OFF ⇒ inert; today's normalization is
-- unchanged and an unmapped tag always keeps the default behaviour).
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS only, no
-- ALTER TYPE, no new pg enum):
--   1. CREATE TABLE uns_tag_mappings.
--   2. CREATE the unique (adapterId, tag) constraint + supporting lookup indexes.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "uns_tag_mappings" (
  "id"              serial PRIMARY KEY,
  "adapterId"       integer NOT NULL,
  "tag"             varchar(128) NOT NULL,
  "unsTopic"        varchar(500) NOT NULL,
  "sparkplugMetric" varchar(255),
  "transform"       jsonb,
  "enabled"         boolean NOT NULL DEFAULT true,
  "notes"           text,
  "createdBy"       integer,
  "createdAt"       timestamp NOT NULL DEFAULT now(),
  "updatedAt"       timestamp NOT NULL DEFAULT now()
);

-- One mapping per (adapter, tag).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_uns_tag_mappings_adapter_tag'
  ) THEN
    ALTER TABLE "uns_tag_mappings"
      ADD CONSTRAINT "uq_uns_tag_mappings_adapter_tag" UNIQUE ("adapterId", "tag");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_uns_tag_mappings_adapter"
  ON "uns_tag_mappings" ("adapterId");
CREATE INDEX IF NOT EXISTS "idx_uns_tag_mappings_enabled"
  ON "uns_tag_mappings" ("enabled");
