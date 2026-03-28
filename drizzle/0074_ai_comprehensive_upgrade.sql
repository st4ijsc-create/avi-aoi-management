-- Migration 0074: AI Comprehensive Upgrade
-- Adds batch inference, A/B testing, model monitoring, training pipeline, edge deployment

-- ============ NEW ENUMS ============
DO $$ BEGIN
  CREATE TYPE "batchjobstatusenum" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "batchitemstatusenum" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "abteststatusenum" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "abtestvariantenum" AS ENUM ('A', 'B');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "abtestwinnerenum" AS ENUM ('A', 'B', 'INCONCLUSIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "driftalerttypeenum" AS ENUM ('ACCURACY_DROP', 'LATENCY_SPIKE', 'DRIFT_DETECTED', 'ERROR_RATE_HIGH', 'CONFIDENCE_SHIFT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "driftseverityenum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "edgedeploystatusenum" AS ENUM ('PENDING', 'PACKAGING', 'READY', 'DOWNLOADING', 'DEPLOYED', 'ACTIVE', 'FAILED', 'OUTDATED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "trainingjobstatusenum" AS ENUM ('QUEUED', 'PREPARING_DATA', 'TRAINING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============ BATCH INFERENCE TABLES ============

CREATE TABLE IF NOT EXISTS "batch_inference_jobs" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "status" "batchjobstatusenum" DEFAULT 'PENDING' NOT NULL,
  "totalItems" integer DEFAULT 0 NOT NULL,
  "completedItems" integer DEFAULT 0 NOT NULL,
  "failedItems" integer DEFAULT 0 NOT NULL,
  "concurrency" integer DEFAULT 4 NOT NULL,
  "priority" integer DEFAULT 5 NOT NULL,
  "resultsSummary" json,
  "errorLog" text,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "startedAt" timestamp,
  "completedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_batch_jobs_model" ON "batch_inference_jobs" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_batch_jobs_status" ON "batch_inference_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_batch_jobs_created" ON "batch_inference_jobs" ("createdAt");

CREATE TABLE IF NOT EXISTS "batch_inference_items" (
  "id" serial PRIMARY KEY,
  "batchJobId" integer NOT NULL,
  "inputReference" text NOT NULL,
  "inputType" varchar(50) DEFAULT 'image' NOT NULL,
  "status" "batchitemstatusenum" DEFAULT 'PENDING' NOT NULL,
  "predictions" json,
  "confidence" decimal(5,4),
  "topLabel" varchar(100),
  "processingTimeMs" integer,
  "errorMessage" text,
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "completedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_batch_items_job" ON "batch_inference_items" ("batchJobId");
CREATE INDEX IF NOT EXISTS "idx_batch_items_status" ON "batch_inference_items" ("status");

-- ============ A/B TESTING TABLES ============

CREATE TABLE IF NOT EXISTS "ab_test_experiments" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "description" text,
  "modelAId" integer NOT NULL,
  "modelAVersion" varchar(50),
  "modelBId" integer NOT NULL,
  "modelBVersion" varchar(50),
  "trafficSplitPercent" integer DEFAULT 50 NOT NULL,
  "status" "abteststatusenum" DEFAULT 'DRAFT' NOT NULL,
  "productModelId" integer,
  "totalInferences" integer DEFAULT 0 NOT NULL,
  "modelAInferences" integer DEFAULT 0 NOT NULL,
  "modelBInferences" integer DEFAULT 0 NOT NULL,
  "modelAAccuracy" decimal(5,4),
  "modelBAccuracy" decimal(5,4),
  "modelAAvgLatency" decimal(10,2),
  "modelBAvgLatency" decimal(10,2),
  "winner" "abtestwinnerenum",
  "statisticalSignificance" decimal(5,4),
  "startDate" timestamp,
  "endDate" timestamp,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ab_test_status" ON "ab_test_experiments" ("status");
CREATE INDEX IF NOT EXISTS "idx_ab_test_product" ON "ab_test_experiments" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_ab_test_models" ON "ab_test_experiments" ("modelAId", "modelBId");

CREATE TABLE IF NOT EXISTS "ab_test_results" (
  "id" serial PRIMARY KEY,
  "experimentId" integer NOT NULL,
  "variant" "abtestvariantenum" NOT NULL,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "inputReference" text,
  "predictions" json NOT NULL,
  "confidence" decimal(5,4),
  "topLabel" varchar(100),
  "processingTimeMs" integer,
  "feedbackType" "feedbacktypeenum",
  "isCorrect" boolean,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ab_results_experiment" ON "ab_test_results" ("experimentId");
CREATE INDEX IF NOT EXISTS "idx_ab_results_variant" ON "ab_test_results" ("variant");
CREATE INDEX IF NOT EXISTS "idx_ab_results_created" ON "ab_test_results" ("createdAt");

-- ============ MODEL MONITORING TABLES ============

CREATE TABLE IF NOT EXISTS "model_performance_snapshots" (
  "id" serial PRIMARY KEY,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "totalInferences" integer DEFAULT 0 NOT NULL,
  "completedInferences" integer DEFAULT 0 NOT NULL,
  "failedInferences" integer DEFAULT 0 NOT NULL,
  "avgLatencyMs" decimal(10,2),
  "p50LatencyMs" decimal(10,2),
  "p95LatencyMs" decimal(10,2),
  "p99LatencyMs" decimal(10,2),
  "accuracy" decimal(5,4),
  "precision" decimal(5,4),
  "recall" decimal(5,4),
  "f1Score" decimal(5,4),
  "driftScore" decimal(5,4),
  "driftDetails" json,
  "confidenceDistribution" json,
  "labelDistribution" json,
  "errorRate" decimal(5,4),
  "timeoutRate" decimal(5,4),
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_perf_snapshot_model" ON "model_performance_snapshots" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_perf_snapshot_period" ON "model_performance_snapshots" ("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "idx_perf_snapshot_created" ON "model_performance_snapshots" ("createdAt");

CREATE TABLE IF NOT EXISTS "model_drift_alerts" (
  "id" serial PRIMARY KEY,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "alertType" "driftalerttypeenum" NOT NULL,
  "severity" "driftseverityenum" DEFAULT 'MEDIUM' NOT NULL,
  "message" text NOT NULL,
  "details" json,
  "currentValue" decimal(10,4),
  "baselineValue" decimal(10,4),
  "acknowledged" boolean DEFAULT false NOT NULL,
  "acknowledgedBy" integer,
  "acknowledgedAt" timestamp,
  "resolvedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_drift_alert_model" ON "model_drift_alerts" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_drift_alert_type" ON "model_drift_alerts" ("alertType");
CREATE INDEX IF NOT EXISTS "idx_drift_alert_severity" ON "model_drift_alerts" ("severity");
CREATE INDEX IF NOT EXISTS "idx_drift_alert_acknowledged" ON "model_drift_alerts" ("acknowledged");

-- ============ TRAINING PIPELINE TABLES ============

CREATE TABLE IF NOT EXISTS "training_jobs" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "modelId" integer NOT NULL,
  "targetVersion" varchar(50) NOT NULL,
  "status" "trainingjobstatusenum" DEFAULT 'QUEUED' NOT NULL,
  "datasetConfig" json NOT NULL,
  "trainingConfig" json,
  "progress" integer DEFAULT 0 NOT NULL,
  "currentEpoch" integer DEFAULT 0,
  "totalEpochs" integer,
  "trainingMetrics" json,
  "validationMetrics" json,
  "bestMetrics" json,
  "outputModelPath" text,
  "outputModelKey" varchar(255),
  "trainingDataCount" integer DEFAULT 0 NOT NULL,
  "validationDataCount" integer DEFAULT 0 NOT NULL,
  "errorMessage" text,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "startedAt" timestamp,
  "completedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_training_jobs_model" ON "training_jobs" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_training_jobs_status" ON "training_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_training_jobs_created" ON "training_jobs" ("createdAt");

CREATE TABLE IF NOT EXISTS "training_datasets" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "description" text,
  "modelId" integer,
  "productModelId" integer,
  "totalSamples" integer DEFAULT 0 NOT NULL,
  "labelDistribution" json,
  "splitConfig" json,
  "sourceType" varchar(50) DEFAULT 'feedback' NOT NULL,
  "filterConfig" json,
  "storageKey" varchar(255),
  "fileSize" integer,
  "status" "batchjobstatusenum" DEFAULT 'PENDING' NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_training_datasets_model" ON "training_datasets" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_training_datasets_product" ON "training_datasets" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_training_datasets_status" ON "training_datasets" ("status");

-- ============ EDGE DEPLOYMENT TABLES ============

CREATE TABLE IF NOT EXISTS "edge_deployments" (
  "id" serial PRIMARY KEY,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "deviceId" varchar(100) NOT NULL,
  "deviceName" varchar(255),
  "deviceType" varchar(100) DEFAULT 'AOI_MACHINE' NOT NULL,
  "machineId" integer,
  "packageUrl" text,
  "packageKey" varchar(255),
  "packageSize" integer,
  "packageHash" varchar(128),
  "status" "edgedeploystatusenum" DEFAULT 'PENDING' NOT NULL,
  "deployConfig" json,
  "lastSyncAt" timestamp,
  "lastHeartbeatAt" timestamp,
  "offlineResultsPending" integer DEFAULT 0 NOT NULL,
  "errorMessage" text,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_edge_deploy_model" ON "edge_deployments" ("modelId");
CREATE INDEX IF NOT EXISTS "idx_edge_deploy_device" ON "edge_deployments" ("deviceId");
CREATE INDEX IF NOT EXISTS "idx_edge_deploy_machine" ON "edge_deployments" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_edge_deploy_status" ON "edge_deployments" ("status");

CREATE TABLE IF NOT EXISTS "edge_inference_sync" (
  "id" serial PRIMARY KEY,
  "deploymentId" integer NOT NULL,
  "modelId" integer NOT NULL,
  "modelVersion" varchar(50),
  "inputReference" text,
  "predictions" json NOT NULL,
  "confidence" decimal(5,4),
  "topLabel" varchar(100),
  "processingTimeMs" integer,
  "inferredAt" timestamp NOT NULL,
  "deviceId" varchar(100) NOT NULL,
  "synced" boolean DEFAULT false NOT NULL,
  "syncedAt" timestamp,
  "inspectionId" integer,
  "measurementResultId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_edge_sync_deployment" ON "edge_inference_sync" ("deploymentId");
CREATE INDEX IF NOT EXISTS "idx_edge_sync_device" ON "edge_inference_sync" ("deviceId");
CREATE INDEX IF NOT EXISTS "idx_edge_sync_synced" ON "edge_inference_sync" ("synced");
CREATE INDEX IF NOT EXISTS "idx_edge_sync_inferred" ON "edge_inference_sync" ("inferredAt");
