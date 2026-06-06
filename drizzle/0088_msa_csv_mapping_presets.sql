-- Step 12: Shared CSV mapping presets for MSA batch import
-- Team/project-level persistence (server-side) instead of browser-local storage only.

CREATE TABLE IF NOT EXISTS msa_csv_mapping_presets (
  id serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  "sourceMachine" varchar(120) NOT NULL,
  "presetName" varchar(120) NOT NULL,
  "instrumentId" integer,
  "hasHeader" boolean NOT NULL DEFAULT true,
  "columnMap" jsonb NOT NULL,
  "createdBy" integer,
  "updatedBy" integer,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_msa_csv_mapping_presets_product_model'
  ) THEN
    ALTER TABLE msa_csv_mapping_presets
      ADD CONSTRAINT fk_msa_csv_mapping_presets_product_model
      FOREIGN KEY ("productModelId")
      REFERENCES product_models(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_msa_csv_mapping_presets_instrument'
  ) THEN
    ALTER TABLE msa_csv_mapping_presets
      ADD CONSTRAINT fk_msa_csv_mapping_presets_instrument
      FOREIGN KEY ("instrumentId")
      REFERENCES measurement_instruments(id)
      ON DELETE SET NULL;
  END IF;
END $$;
