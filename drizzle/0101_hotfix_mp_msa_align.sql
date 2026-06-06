-- 0101 hotfix: align DB with current Drizzle schema for measurement points,
-- instruments, and MSA wizard tables. Idempotent.

-- measurement_point_defs: missing columns
ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "preferredSamplingPlanId" integer,
  ADD COLUMN IF NOT EXISTS "productViewId" integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpd_product_view') THEN
    ALTER TABLE "measurement_point_defs"
      ADD CONSTRAINT fk_mpd_product_view
      FOREIGN KEY ("productViewId") REFERENCES "product_views"(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mpd_sampling_plan') THEN
    ALTER TABLE "measurement_point_defs"
      ADD CONSTRAINT fk_mpd_sampling_plan
      FOREIGN KEY ("preferredSamplingPlanId") REFERENCES "sampling_plans"(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- measurement_instruments: missing column
ALTER TABLE "measurement_instruments"
  ADD COLUMN IF NOT EXISTS "mmPerPixel" numeric(15,8);

-- msa_studies
CREATE TABLE IF NOT EXISTS "msa_studies" (
  id serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "measurementPointDefId" integer,
  "instrumentId" integer,
  "studyCode" varchar(60) NOT NULL,
  name varchar(255) NOT NULL,
  "studyType" varchar(30) DEFAULT 'gage_rr' NOT NULL,
  "operatorCount" integer DEFAULT 3 NOT NULL,
  "partCount" integer DEFAULT 10 NOT NULL,
  "trialCount" integer DEFAULT 2 NOT NULL,
  status varchar(20) DEFAULT 'draft' NOT NULL,
  summary jsonb,
  "startedAt" timestamp,
  "completedAt" timestamp,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msa_studies_product_code
  ON msa_studies ("productModelId", "studyCode");
CREATE INDEX IF NOT EXISTS idx_msa_studies_product ON msa_studies ("productModelId");
CREATE INDEX IF NOT EXISTS idx_msa_studies_status ON msa_studies (status);
CREATE INDEX IF NOT EXISTS idx_msa_studies_deleted_at ON msa_studies ("deletedAt");

-- msa_observations
CREATE TABLE IF NOT EXISTS "msa_observations" (
  id serial PRIMARY KEY,
  "studyId" integer NOT NULL,
  "operatorName" varchar(120) NOT NULL,
  "partLabel" varchar(120) NOT NULL,
  "trialNo" integer NOT NULL,
  "measuredValue" numeric(15,6) NOT NULL,
  notes text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msa_observations_matrix_cell
  ON msa_observations ("studyId", "operatorName", "partLabel", "trialNo");
CREATE INDEX IF NOT EXISTS idx_msa_observations_study ON msa_observations ("studyId");
CREATE INDEX IF NOT EXISTS idx_msa_observations_operator ON msa_observations ("operatorName");
CREATE INDEX IF NOT EXISTS idx_msa_observations_part ON msa_observations ("partLabel");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_msa_obs_study') THEN
    ALTER TABLE "msa_observations"
      ADD CONSTRAINT fk_msa_obs_study
      FOREIGN KEY ("studyId") REFERENCES "msa_studies"(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- msa_csv_mapping_presets
CREATE TABLE IF NOT EXISTS "msa_csv_mapping_presets" (
  id serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "sourceMachine" varchar(120) NOT NULL,
  "presetName" varchar(120) NOT NULL,
  "instrumentId" integer,
  "hasHeader" boolean DEFAULT true NOT NULL,
  "columnMap" jsonb NOT NULL,
  "createdBy" integer,
  "updatedBy" integer,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_msa_csv_mapping_presets_scope
  ON msa_csv_mapping_presets ("productModelId", "sourceMachine", "presetName");
CREATE INDEX IF NOT EXISTS idx_msa_csv_mapping_presets_product
  ON msa_csv_mapping_presets ("productModelId");
CREATE INDEX IF NOT EXISTS idx_msa_csv_mapping_presets_source
  ON msa_csv_mapping_presets ("sourceMachine");
CREATE INDEX IF NOT EXISTS idx_msa_csv_mapping_presets_deleted_at
  ON msa_csv_mapping_presets ("deletedAt");
