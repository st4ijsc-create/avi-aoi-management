-- ============================================================================
-- Migration 0091: P4.A G17 — Measurement Point Lighting / Illumination Profile
-- One MP can have multiple shots (e.g., shot-1 ring-white for presence,
-- shot-2 coaxial-blue for scratch detection).
-- Used by AOI/AVI machines via MQTT recipe payload.
-- All additive, idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "mp_lighting_profiles" (
  "id" serial PRIMARY KEY,
  "pointDefId" integer NOT NULL,
  -- shotIndex 1..N (multi-shot per MP); used for ordering
  "shotIndex" integer NOT NULL DEFAULT 1,
  "name" varchar(120),
  -- ring | coaxial | dome | side_low_angle | back | uv | ir | multi_spectral | dark_field
  "lightSource" varchar(40) NOT NULL DEFAULT 'ring',
  -- white | red | green | blue | rgb | ir | uv | custom
  "color" varchar(20) NOT NULL DEFAULT 'white',
  -- custom color hex (when color='custom')
  "colorHex" varchar(7),
  -- 0 .. 100 percent
  "intensityPct" integer NOT NULL DEFAULT 100,
  -- light incidence angle in degrees (0=normal/coaxial, 90=grazing)
  "angleDeg" integer,
  -- camera exposure time in microseconds
  "exposureUs" integer,
  -- camera analog/digital gain (e.g. 1.0 .. 16.0)
  "gain" numeric(8, 3),
  -- camera focus offset (relative, +/- microns)
  "focusOffsetUm" integer,
  -- optional filter (polarizer, IR-cut, bandpass nm)
  "opticalFilter" varchar(60),
  -- expected feature this shot is targeting (presence | scratch | color | ocr | solder_height | ...)
  "purpose" varchar(60),
  -- optional reference image taken with this profile (key + url)
  "referenceImageUrl" text,
  "referenceImageKey" varchar(255),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  "deletedAt" timestamp,
  CONSTRAINT "chk_mp_lighting_intensity"
    CHECK ("intensityPct" BETWEEN 0 AND 100),
  CONSTRAINT "chk_mp_lighting_angle"
    CHECK ("angleDeg" IS NULL OR "angleDeg" BETWEEN 0 AND 90)
);

CREATE INDEX IF NOT EXISTS "idx_mp_lighting_point" ON "mp_lighting_profiles" ("pointDefId");
CREATE INDEX IF NOT EXISTS "idx_mp_lighting_active" ON "mp_lighting_profiles" ("isActive");
CREATE INDEX IF NOT EXISTS "idx_mp_lighting_deleted_at" ON "mp_lighting_profiles" ("deletedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mp_lighting_point_shot"
  ON "mp_lighting_profiles" ("pointDefId","shotIndex")
  WHERE "deletedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_mp_lighting_point'
  ) THEN
    ALTER TABLE "mp_lighting_profiles"
      ADD CONSTRAINT "fk_mp_lighting_point"
      FOREIGN KEY ("pointDefId") REFERENCES "measurement_point_defs" ("id")
      ON DELETE CASCADE;
  END IF;
END $$;
