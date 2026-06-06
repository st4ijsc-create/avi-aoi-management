-- P3 foundation: instruments, sampling plans, multi-view references
-- Backward-compatible additive migration.

ALTER TABLE measurement_point_defs
  ADD COLUMN IF NOT EXISTS "preferredInstrumentId" integer;

CREATE TABLE IF NOT EXISTS measurement_instruments (
  id serial PRIMARY KEY,
  code varchar(50) NOT NULL,
  name varchar(255) NOT NULL,
  "instrumentType" varchar(80) NOT NULL,
  manufacturer varchar(120),
  model varchar(120),
  "serialNumber" varchar(120),
  "defaultUnit" varchar(20),
  resolution numeric(15,6),
  uncertainty numeric(15,6),
  "calibrationPeriodDays" integer,
  "lastCalibrationAt" timestamp,
  "nextCalibrationAt" timestamp,
  "msaMethod" varchar(50),
  notes text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_measurement_instruments_code
  ON measurement_instruments (code);
CREATE INDEX IF NOT EXISTS idx_measurement_instruments_type
  ON measurement_instruments ("instrumentType");
CREATE INDEX IF NOT EXISTS idx_measurement_instruments_active
  ON measurement_instruments ("isActive");
CREATE INDEX IF NOT EXISTS idx_measurement_instruments_deleted_at
  ON measurement_instruments ("deletedAt");

CREATE TABLE IF NOT EXISTS sampling_plans (
  id serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  code varchar(60) NOT NULL,
  name varchar(255) NOT NULL,
  strategy varchar(30) NOT NULL DEFAULT 'fixed_n',
  "lotSize" integer,
  "aqlCritical" numeric(6,3),
  "aqlMajor" numeric(6,3),
  "aqlMinor" numeric(6,3),
  "sampleSize" integer,
  "acceptanceQty" integer,
  "rejectionQty" integer,
  rules jsonb,
  version integer NOT NULL DEFAULT 1,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sampling_plans_product_code
  ON sampling_plans ("productModelId", code);
CREATE INDEX IF NOT EXISTS idx_sampling_plans_product
  ON sampling_plans ("productModelId");
CREATE INDEX IF NOT EXISTS idx_sampling_plans_active
  ON sampling_plans ("isActive");

CREATE TABLE IF NOT EXISTS product_views (
  id serial PRIMARY KEY,
  "productModelId" integer NOT NULL,
  code varchar(50) NOT NULL,
  name varchar(255) NOT NULL,
  "viewType" varchar(30) NOT NULL DEFAULT 'top',
  "referenceImageUrl" text,
  "referenceImageKey" varchar(255),
  transform jsonb,
  "orderIndex" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_views_product_code
  ON product_views ("productModelId", code);
CREATE INDEX IF NOT EXISTS idx_product_views_product
  ON product_views ("productModelId");
CREATE INDEX IF NOT EXISTS idx_product_views_order
  ON product_views ("productModelId", "orderIndex");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_measurement_point_defs_preferred_instrument'
  ) THEN
    ALTER TABLE measurement_point_defs
      ADD CONSTRAINT fk_measurement_point_defs_preferred_instrument
      FOREIGN KEY ("preferredInstrumentId")
      REFERENCES measurement_instruments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_sampling_plans_product_model'
  ) THEN
    ALTER TABLE sampling_plans
      ADD CONSTRAINT fk_sampling_plans_product_model
      FOREIGN KEY ("productModelId")
      REFERENCES product_models(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_product_views_product_model'
  ) THEN
    ALTER TABLE product_views
      ADD CONSTRAINT fk_product_views_product_model
      FOREIGN KEY ("productModelId")
      REFERENCES product_models(id)
      ON DELETE CASCADE;
  END IF;
END $$;
