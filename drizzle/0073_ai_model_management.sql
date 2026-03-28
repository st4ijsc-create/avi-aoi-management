-- Migration 0073: AI Model Management for Offline AI Integration
-- Adds tables for ML model lifecycle, versioning, and inference tracking

-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE "public"."model_format" AS ENUM ('ONNX', 'TENSORRT', 'OPENVINO', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."model_status" AS ENUM ('UPLOADING', 'VALIDATING', 'READY', 'ACTIVE', 'INACTIVE', 'FAILED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."inference_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============ AI MODELS — Core model registry ============
CREATE TABLE IF NOT EXISTS "ai_models" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(100) NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "modelType" varchar(100) NOT NULL,
  "format" "model_format" NOT NULL DEFAULT 'ONNX',
  "currentVersion" varchar(50),
  "filePath" text,
  "fileKey" varchar(255),
  "fileSize" integer,
  "inputShape" json,
  "outputShape" json,
  "labels" json,
  "preprocessConfig" json,
  "postprocessConfig" json,
  "status" "model_status" NOT NULL DEFAULT 'UPLOADING',
  "metadata" json,
  "productModelId" integer,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- ============ MODEL VERSIONS — Version history for each model ============
CREATE TABLE IF NOT EXISTS "model_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "modelId" integer NOT NULL,
  "version" varchar(50) NOT NULL,
  "filePath" text,
  "fileKey" varchar(255),
  "fileSize" integer,
  "changeLog" text,
  "metrics" json,
  "accuracy" decimal(5, 2),
  "status" "model_status" NOT NULL DEFAULT 'UPLOADING',
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ============ INFERENCE RESULTS — Individual inference run tracking ============
CREATE TABLE IF NOT EXISTS "inference_results" (
  "id" serial PRIMARY KEY NOT NULL,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "inspectionId" integer,
  "measurementResultId" integer,
  "inputType" varchar(50) NOT NULL DEFAULT 'image',
  "inputReference" text,
  "predictions" json NOT NULL,
  "confidence" decimal(5, 4),
  "topLabel" varchar(100),
  "processingTimeMs" integer,
  "status" "inference_status" NOT NULL DEFAULT 'COMPLETED',
  "errorMessage" text,
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS "idx_ai_models_code" ON "ai_models" ("code");
CREATE INDEX IF NOT EXISTS "idx_ai_models_type" ON "ai_models" ("modelType");
CREATE INDEX IF NOT EXISTS "idx_ai_models_format" ON "ai_models" ("format");
CREATE INDEX IF NOT EXISTS "idx_ai_models_status" ON "ai_models" ("status");
CREATE INDEX IF NOT EXISTS "idx_ai_models_product" ON "ai_models" ("productModelId");

CREATE INDEX IF NOT EXISTS "idx_model_versions_model" ON "model_versions" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_model_versions_version" ON "model_versions" ("modelId", "version");
CREATE INDEX IF NOT EXISTS "idx_model_versions_status" ON "model_versions" ("status");

CREATE INDEX IF NOT EXISTS "idx_inference_results_model" ON "inference_results" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_inference_results_inspection" ON "inference_results" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_inference_results_measurement" ON "inference_results" ("measurementResultId");
CREATE INDEX IF NOT EXISTS "idx_inference_results_status" ON "inference_results" ("status");
CREATE INDEX IF NOT EXISTS "idx_inference_results_created" ON "inference_results" ("createdAt");
