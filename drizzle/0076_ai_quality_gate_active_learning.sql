-- Migration: AI Quality Gate, Ensemble, Image Embeddings & Active Learning
-- Adds new enums, tables, and columns for AI quality gate auto-decision,
-- multi-model ensemble inference, pgvector image similarity search, and active learning pipeline.

-- ============ NEW ENUMS ============

DO $$ BEGIN
  CREATE TYPE "aidecisionenum" AS ENUM ('AUTO_OK', 'AUTO_NG', 'NEEDS_REVIEW', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ensemblestrategyenum" AS ENUM ('VOTING', 'WEIGHTED_AVERAGE', 'STACKING', 'CASCADE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "labelqueuestatusenum" AS ENUM ('PENDING', 'IN_REVIEW', 'LABELED', 'AUTO_LABELED', 'SKIPPED', 'EXPERT_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "samplingstrategyenum" AS ENUM ('UNCERTAINTY', 'DIVERSITY', 'COMMITTEE', 'RANDOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============ ALTER product_inspections: Add AI Quality Gate columns ============

ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiDecision" "aidecisionenum";
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiConfidence" decimal(5,4);
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiModelId" integer;
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiProcessedAt" timestamp;
ALTER TABLE "product_inspections" ADD COLUMN IF NOT EXISTS "aiDetails" json;

CREATE INDEX IF NOT EXISTS "idx_inspections_ai_decision" ON "product_inspections" ("aiDecision");
CREATE INDEX IF NOT EXISTS "idx_inspections_ai_model" ON "product_inspections" ("aiModelId");
CREATE INDEX IF NOT EXISTS "idx_inspections_ai_processed" ON "product_inspections" ("aiProcessedAt");

-- ============ AI Quality Gate Configs ============

CREATE TABLE IF NOT EXISTS "ai_quality_gate_configs" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "machineId" integer,
  "productModelId" integer,
  "modelId" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "autoOkThreshold" decimal(5,4) DEFAULT '0.95' NOT NULL,
  "autoNgThreshold" decimal(5,4) DEFAULT '0.85' NOT NULL,
  "reviewThreshold" decimal(5,4) DEFAULT '0.60' NOT NULL,
  "ngLabels" json DEFAULT '[]' NOT NULL,
  "okLabels" json DEFAULT '[]' NOT NULL,
  "ensembleConfigId" integer,
  "alertOnAutoNg" boolean DEFAULT true NOT NULL,
  "metadata" json,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_qg_config_machine" ON "ai_quality_gate_configs" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_qg_config_product" ON "ai_quality_gate_configs" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_qg_config_model" ON "ai_quality_gate_configs" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_qg_config_enabled" ON "ai_quality_gate_configs" ("enabled");

-- ============ AI Ensemble Configs ============

CREATE TABLE IF NOT EXISTS "ai_ensemble_configs" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "strategy" "ensemblestrategyenum" DEFAULT 'VOTING' NOT NULL,
  "modelIds" json NOT NULL,
  "weights" json,
  "productModelId" integer,
  "cascadeThreshold" decimal(5,4),
  "enabled" boolean DEFAULT true NOT NULL,
  "metadata" json,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ensemble_config_product" ON "ai_ensemble_configs" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_ensemble_config_enabled" ON "ai_ensemble_configs" ("enabled");

-- ============ AI Quality Gate Results ============

CREATE TABLE IF NOT EXISTS "ai_quality_gate_results" (
  "id" serial PRIMARY KEY,
  "inspectionId" integer NOT NULL,
  "configId" integer NOT NULL,
  "decision" "aidecisionenum" NOT NULL,
  "confidence" decimal(5,4) NOT NULL,
  "topLabel" varchar(100),
  "predictions" json,
  "ensembleResults" json,
  "processingTimeMs" integer,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "reviewDecision" varchar(20),
  "reviewNotes" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_qg_result_inspection" ON "ai_quality_gate_results" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_qg_result_config" ON "ai_quality_gate_results" ("configId");
CREATE INDEX IF NOT EXISTS "idx_qg_result_decision" ON "ai_quality_gate_results" ("decision");
CREATE INDEX IF NOT EXISTS "idx_qg_result_created" ON "ai_quality_gate_results" ("createdAt");

-- ============ AI Image Embeddings (pgvector) ============

-- Enable pgvector extension (safe to call multiple times)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "ai_image_embeddings" (
  "id" serial PRIMARY KEY,
  "inspectionId" integer,
  "measurementResultId" integer,
  "imageUrl" text NOT NULL,
  "embedding" text NOT NULL,
  "embeddingDim" integer NOT NULL,
  "modelCode" varchar(100) NOT NULL,
  "label" varchar(255),
  "confidence" decimal(5,4),
  "defectType" varchar(255),
  "machineId" integer,
  "productModelId" integer,
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_image_emb_inspection" ON "ai_image_embeddings" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_image_emb_measurement" ON "ai_image_embeddings" ("measurementResultId");
CREATE INDEX IF NOT EXISTS "idx_image_emb_model" ON "ai_image_embeddings" ("modelCode");
CREATE INDEX IF NOT EXISTS "idx_image_emb_machine" ON "ai_image_embeddings" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_image_emb_product" ON "ai_image_embeddings" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_image_emb_label" ON "ai_image_embeddings" ("label");
CREATE INDEX IF NOT EXISTS "idx_image_emb_created" ON "ai_image_embeddings" ("createdAt");

-- ============ Active Learning Label Queue ============

CREATE TABLE IF NOT EXISTS "ai_label_queue" (
  "id" serial PRIMARY KEY,
  "inspectionId" integer,
  "measurementResultId" integer,
  "imageUrl" text NOT NULL,
  -- AI prediction
  "modelId" integer NOT NULL,
  "predictedLabel" varchar(100),
  "confidence" decimal(5,4),
  "predictions" json,
  "uncertainty" decimal(5,4),
  -- Ensemble disagreement
  "ensembleDisagreement" decimal(5,4),
  "ensemblePredictions" json,
  -- Active learning metadata
  "samplingStrategy" "samplingstrategyenum" DEFAULT 'UNCERTAINTY' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "status" "labelqueuestatusenum" DEFAULT 'PENDING' NOT NULL,
  -- Human review
  "assignedTo" integer,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "humanLabel" varchar(100),
  "reviewNotes" text,
  -- Context
  "machineId" integer,
  "productModelId" integer,
  "defectType" varchar(100),
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_label_queue_status" ON "ai_label_queue" ("status");
CREATE INDEX IF NOT EXISTS "idx_label_queue_model" ON "ai_label_queue" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_label_queue_priority" ON "ai_label_queue" ("priority");
CREATE INDEX IF NOT EXISTS "idx_label_queue_machine" ON "ai_label_queue" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_label_queue_product" ON "ai_label_queue" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_label_queue_assigned" ON "ai_label_queue" ("assignedTo");
CREATE INDEX IF NOT EXISTS "idx_label_queue_created" ON "ai_label_queue" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_label_queue_confidence" ON "ai_label_queue" ("confidence");
