-- B2 — Confidence calibration reports (ECE / reliability diagram).
-- New, additive, idempotent. Stores per-model calibration metrics over a labelled
-- period (ground truth = aiQualityGateResults.reviewDecision). Writing here NEVER
-- changes inference behaviour — temperature scaling stays opt-in via the model's
-- postprocessConfig.temperatureScale (default 1 = identity).

CREATE TABLE IF NOT EXISTS "ai_calibration_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "machineId" integer,
  "productModelId" integer,
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "sampleCount" integer DEFAULT 0 NOT NULL,
  "ece" numeric(7, 6),
  "mce" numeric(7, 6),
  "brierScore" numeric(7, 6),
  "temperature" numeric(8, 4),
  "eceAfterTemp" numeric(7, 6),
  "numBins" integer DEFAULT 10 NOT NULL,
  "reliabilityBins" json NOT NULL,
  "metadata" json,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ai_calibration_model" ON "ai_calibration_reports" ("modelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_calibration_period" ON "ai_calibration_reports" ("periodStart", "periodEnd");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_calibration_created" ON "ai_calibration_reports" ("createdAt");
