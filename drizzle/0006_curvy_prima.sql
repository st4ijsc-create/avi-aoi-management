CREATE TYPE "public"."abteststatusenum" AS ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."abtestvariantenum" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."abtestwinnerenum" AS ENUM('A', 'B', 'INCONCLUSIVE');--> statement-breakpoint
CREATE TYPE "public"."aidecisionenum" AS ENUM('AUTO_OK', 'AUTO_NG', 'NEEDS_REVIEW', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."apikeyprovider" AS ENUM('openai', 'azure_openai', 'huggingface', 'custom');--> statement-breakpoint
CREATE TYPE "public"."apikeystatus" AS ENUM('active', 'inactive', 'expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."batchitemstatusenum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."batchjobstatusenum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."chatroleenum" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."driftalerttypeenum" AS ENUM('ACCURACY_DROP', 'LATENCY_SPIKE', 'DRIFT_DETECTED', 'ERROR_RATE_HIGH', 'CONFIDENCE_SHIFT');--> statement-breakpoint
CREATE TYPE "public"."driftseverityenum" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."edgedeploystatusenum" AS ENUM('PENDING', 'PACKAGING', 'READY', 'DOWNLOADING', 'DEPLOYED', 'ACTIVE', 'FAILED', 'OUTDATED');--> statement-breakpoint
CREATE TYPE "public"."ensemblestrategyenum" AS ENUM('VOTING', 'WEIGHTED_AVERAGE', 'STACKING', 'CASCADE');--> statement-breakpoint
CREATE TYPE "public"."inferencestatusenum" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT');--> statement-breakpoint
CREATE TYPE "public"."labelqueuestatusenum" AS ENUM('PENDING', 'IN_REVIEW', 'LABELED', 'AUTO_LABELED', 'SKIPPED', 'EXPERT_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."modelformatenum" AS ENUM('ONNX', 'TENSORRT', 'OPENVINO', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."modelstatusenum" AS ENUM('UPLOADING', 'VALIDATING', 'READY', 'ACTIVE', 'INACTIVE', 'FAILED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."samplingstrategyenum" AS ENUM('UNCERTAINTY', 'DIVERSITY', 'COMMITTEE', 'RANDOM');--> statement-breakpoint
CREATE TYPE "public"."syncoperationenum" AS ENUM('POINTS_PUSH', 'POINTS_PULL', 'IMAGE_PUSH', 'IMAGE_PULL', 'FULL_SYNC', 'DELTA_SYNC');--> statement-breakpoint
CREATE TYPE "public"."syncstatusenum" AS ENUM('SUCCESS', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."trainingjobstatusenum" AS ENUM('QUEUED', 'PREPARING_DATA', 'TRAINING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "ab_test_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"modelAAccuracy" numeric(5, 4),
	"modelBAccuracy" numeric(5, 4),
	"modelAAvgLatency" numeric(10, 2),
	"modelBAvgLatency" numeric(10, 2),
	"winner" "abtestwinnerenum",
	"statisticalSignificance" numeric(5, 4),
	"startDate" timestamp,
	"endDate" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_test_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"experimentId" integer NOT NULL,
	"variant" "abtestvariantenum" NOT NULL,
	"modelId" integer NOT NULL,
	"modelVersion" varchar(50),
	"inputReference" text,
	"predictions" json NOT NULL,
	"confidence" numeric(5, 4),
	"topLabel" varchar(100),
	"processingTimeMs" integer,
	"feedbackType" "feedbacktypeenum",
	"isCorrect" boolean,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" "apikeyprovider" NOT NULL,
	"encryptedKey" text NOT NULL,
	"endpoint" text,
	"status" "apikeystatus" DEFAULT 'active' NOT NULL,
	"lastTestedAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"title" varchar(255),
	"context" json,
	"messageCount" integer DEFAULT 0 NOT NULL,
	"lastMessageAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversationId" integer NOT NULL,
	"role" "chatroleenum" NOT NULL,
	"content" text,
	"toolCalls" json,
	"toolResults" json,
	"tokensUsed" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_ensemble_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"strategy" "ensemblestrategyenum" DEFAULT 'VOTING' NOT NULL,
	"modelIds" json NOT NULL,
	"weights" json,
	"productModelId" integer,
	"cascadeThreshold" numeric(5, 4),
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_image_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer,
	"measurementResultId" integer,
	"imageUrl" text NOT NULL,
	"embedding" text NOT NULL,
	"embeddingDim" integer NOT NULL,
	"modelCode" varchar(100) NOT NULL,
	"label" varchar(255),
	"confidence" numeric(5, 4),
	"defectType" varchar(255),
	"machineId" integer,
	"productModelId" integer,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_label_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer,
	"measurementResultId" integer,
	"imageUrl" text NOT NULL,
	"modelId" integer NOT NULL,
	"predictedLabel" varchar(100),
	"confidence" numeric(5, 4),
	"predictions" json,
	"uncertainty" numeric(5, 4),
	"ensembleDisagreement" numeric(5, 4),
	"ensemblePredictions" json,
	"samplingStrategy" "samplingstrategyenum" DEFAULT 'UNCERTAINTY' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "labelqueuestatusenum" DEFAULT 'PENDING' NOT NULL,
	"assignedTo" integer,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"humanLabel" varchar(100),
	"reviewNotes" text,
	"machineId" integer,
	"productModelId" integer,
	"defectType" varchar(100),
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"modelType" varchar(100) NOT NULL,
	"format" "modelformatenum" DEFAULT 'ONNX' NOT NULL,
	"currentVersion" varchar(50),
	"filePath" text,
	"fileKey" varchar(255),
	"fileSize" integer,
	"inputShape" json,
	"outputShape" json,
	"labels" json,
	"preprocessConfig" json,
	"postprocessConfig" json,
	"status" "modelstatusenum" DEFAULT 'UPLOADING' NOT NULL,
	"metadata" json,
	"productModelId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ai_quality_gate_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"machineId" integer,
	"productModelId" integer,
	"modelId" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"autoOkThreshold" numeric(5, 4) DEFAULT '0.95' NOT NULL,
	"autoNgThreshold" numeric(5, 4) DEFAULT '0.85' NOT NULL,
	"reviewThreshold" numeric(5, 4) DEFAULT '0.60' NOT NULL,
	"ngLabels" json DEFAULT '[]'::json NOT NULL,
	"okLabels" json DEFAULT '[]'::json NOT NULL,
	"ensembleConfigId" integer,
	"alertOnAutoNg" boolean DEFAULT true NOT NULL,
	"metadata" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_quality_gate_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer NOT NULL,
	"configId" integer NOT NULL,
	"decision" "aidecisionenum" NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "ai_system_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updatedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_system_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "batch_inference_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batchJobId" integer NOT NULL,
	"inputReference" text NOT NULL,
	"inputType" varchar(50) DEFAULT 'image' NOT NULL,
	"status" "batchitemstatusenum" DEFAULT 'PENDING' NOT NULL,
	"predictions" json,
	"confidence" numeric(5, 4),
	"topLabel" varchar(100),
	"processingTimeMs" integer,
	"errorMessage" text,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "batch_inference_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "edge_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "edge_inference_sync" (
	"id" serial PRIMARY KEY NOT NULL,
	"deploymentId" integer NOT NULL,
	"modelId" integer NOT NULL,
	"modelVersion" varchar(50),
	"inputReference" text,
	"predictions" json NOT NULL,
	"confidence" numeric(5, 4),
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
--> statement-breakpoint
CREATE TABLE "image_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer,
	"measurementResultId" integer,
	"imageUrl" text NOT NULL,
	"annotations" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelId" integer NOT NULL,
	"modelVersion" varchar(50),
	"inspectionId" integer,
	"measurementResultId" integer,
	"inputType" varchar(50) DEFAULT 'image' NOT NULL,
	"inputReference" text,
	"predictions" json NOT NULL,
	"confidence" numeric(5, 4),
	"topLabel" varchar(100),
	"processingTimeMs" integer,
	"status" "inferencestatusenum" DEFAULT 'COMPLETED' NOT NULL,
	"errorMessage" text,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_drift_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelId" integer NOT NULL,
	"modelVersion" varchar(50),
	"alertType" "driftalerttypeenum" NOT NULL,
	"severity" "driftseverityenum" DEFAULT 'MEDIUM' NOT NULL,
	"message" text NOT NULL,
	"details" json,
	"currentValue" numeric(10, 4),
	"baselineValue" numeric(10, 4),
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_performance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelId" integer NOT NULL,
	"modelVersion" varchar(50),
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"totalInferences" integer DEFAULT 0 NOT NULL,
	"completedInferences" integer DEFAULT 0 NOT NULL,
	"failedInferences" integer DEFAULT 0 NOT NULL,
	"avgLatencyMs" numeric(10, 2),
	"p50LatencyMs" numeric(10, 2),
	"p95LatencyMs" numeric(10, 2),
	"p99LatencyMs" numeric(10, 2),
	"accuracy" numeric(5, 4),
	"precision" numeric(5, 4),
	"recall" numeric(5, 4),
	"f1Score" numeric(5, 4),
	"driftScore" numeric(5, 4),
	"driftDetails" json,
	"confidenceDistribution" json,
	"labelDistribution" json,
	"errorRate" numeric(5, 4),
	"timeoutRate" numeric(5, 4),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelId" integer NOT NULL,
	"version" varchar(50) NOT NULL,
	"filePath" text,
	"fileKey" varchar(255),
	"fileSize" integer,
	"changeLog" text,
	"metrics" json,
	"accuracy" numeric(5, 2),
	"status" "modelstatusenum" DEFAULT 'UPLOADING' NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_datasets" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "training_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "product_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileKey" varchar(500) NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSize" integer,
	"mimeType" varchar(100) NOT NULL,
	"uploadedBy" integer,
	"uploadedByName" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(50) NOT NULL,
	"productModelId" integer,
	"productModelCode" varchar(100),
	"syncOperation" "syncoperationenum" NOT NULL,
	"syncStatus" "syncstatusenum" DEFAULT 'SUCCESS' NOT NULL,
	"pointsSynced" integer DEFAULT 0,
	"pointsCreated" integer DEFAULT 0,
	"pointsUpdated" integer DEFAULT 0,
	"pointsFailed" integer DEFAULT 0,
	"errorDetails" json,
	"sourceImageWidth" integer,
	"sourceImageHeight" integer,
	"serverImageWidth" integer,
	"serverImageHeight" integer,
	"coordTransformations" integer DEFAULT 0,
	"fromVersion" integer,
	"toVersion" integer,
	"imageHashBefore" varchar(64),
	"imageHashAfter" varchar(64),
	"imageSizeBytes" integer,
	"imageSkipped" boolean DEFAULT false,
	"durationMs" integer,
	"requestSizeBytes" integer,
	"clientVersion" varchar(50),
	"ipAddress" varchar(45),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_ng_alert_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"topicPattern" varchar(500) DEFAULT 'avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors' NOT NULL,
	"externalTopicPattern" varchar(500),
	"sendToLocal" boolean DEFAULT true NOT NULL,
	"sendToExternal" boolean DEFAULT true NOT NULL,
	"sendFcm" boolean DEFAULT true NOT NULL,
	"includeImages" boolean DEFAULT true NOT NULL,
	"includeReferenceImages" boolean DEFAULT true NOT NULL,
	"includePointImages" boolean DEFAULT true NOT NULL,
	"includeOverallResult" boolean DEFAULT true NOT NULL,
	"qos" integer DEFAULT 1 NOT NULL,
	"retain" boolean DEFAULT false NOT NULL,
	"cooldownSeconds" integer DEFAULT 0 NOT NULL,
	"lastTriggeredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_ng_rate_alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"thresholdId" integer NOT NULL,
	"stationId" integer NOT NULL,
	"machineId" integer,
	"measurementPointId" integer,
	"pointName" varchar(255),
	"pointCode" varchar(50),
	"productModelName" varchar(255),
	"currentNgRate" numeric(5, 2) NOT NULL,
	"thresholdValue" numeric(5, 2) NOT NULL,
	"totalInspections" integer NOT NULL,
	"ngCount" integer NOT NULL,
	"severity" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"mqttTopic" varchar(255),
	"sentMqttLocal" boolean DEFAULT false NOT NULL,
	"sentMqttExternal" boolean DEFAULT false NOT NULL,
	"sentFcm" boolean DEFAULT false NOT NULL,
	"payload" json,
	"isResolved" boolean DEFAULT false NOT NULL,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"resolutionNote" text,
	"triggeredAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_ng_rate_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"machineId" integer,
	"measurementPointId" integer,
	"productModelId" integer,
	"name" varchar(255) NOT NULL,
	"description" text,
	"warningThreshold" numeric(5, 2) NOT NULL,
	"criticalThreshold" numeric(5, 2) NOT NULL,
	"minSampleSize" integer DEFAULT 10 NOT NULL,
	"cooldownMinutes" integer DEFAULT 30 NOT NULL,
	"lastTriggeredAt" timestamp,
	"sendMqttLocal" boolean DEFAULT true NOT NULL,
	"sendMqttExternal" boolean DEFAULT true NOT NULL,
	"sendFcm" boolean DEFAULT true NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gate_template_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"templateId" integer NOT NULL,
	"lineId" integer NOT NULL,
	"assignedBy" integer,
	"assignedAt" timestamp with time zone DEFAULT now(),
	"isActive" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "quality_gate_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"standard" varchar(100) DEFAULT 'custom' NOT NULL,
	"category" varchar(100) DEFAULT 'general' NOT NULL,
	"rules" json DEFAULT '[]'::json NOT NULL,
	"notifyRoles" json DEFAULT '["admin","quality_manager"]'::json,
	"createdBy" integer,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DROP INDEX "idx_stats_machine_date";--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "normalizedX" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "normalizedY" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "normalizedRadius" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "imageHash" varchar(64);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "lastModifiedAt" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "product_models" ADD COLUMN "imageDisplayMode" varchar(20) DEFAULT 'contain';--> statement-breakpoint
ALTER TABLE "product_models" ADD COLUMN "pointsConfigVersion" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_models" ADD COLUMN "imageHash" varchar(64);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "aiDecision" "aidecisionenum";--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "aiConfidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "aiModelId" integer;--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "aiProcessedAt" timestamp;--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "aiDetails" json;--> statement-breakpoint
ALTER TABLE "quality_gate_template_assignments" ADD CONSTRAINT "quality_gate_template_assignments_templateId_quality_gate_templates_id_fk" FOREIGN KEY ("templateId") REFERENCES "public"."quality_gate_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_template_assignments" ADD CONSTRAINT "quality_gate_template_assignments_lineId_production_lines_id_fk" FOREIGN KEY ("lineId") REFERENCES "public"."production_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_template_assignments" ADD CONSTRAINT "quality_gate_template_assignments_assignedBy_users_id_fk" FOREIGN KEY ("assignedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_templates" ADD CONSTRAINT "quality_gate_templates_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ab_test_status" ON "ab_test_experiments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ab_test_product" ON "ab_test_experiments" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_ab_test_models" ON "ab_test_experiments" USING btree ("modelAId","modelBId");--> statement-breakpoint
CREATE INDEX "idx_ab_results_experiment" ON "ab_test_results" USING btree ("experimentId");--> statement-breakpoint
CREATE INDEX "idx_ab_results_variant" ON "ab_test_results" USING btree ("variant");--> statement-breakpoint
CREATE INDEX "idx_ab_results_created" ON "ab_test_results" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_ai_api_keys_provider" ON "ai_api_keys" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_ai_api_keys_status" ON "ai_api_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_api_keys_created_by" ON "ai_api_keys" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_chat_conv_user" ON "ai_chat_conversations" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_chat_conv_updated" ON "ai_chat_conversations" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX "idx_chat_msg_conversation" ON "ai_chat_messages" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "idx_chat_msg_role" ON "ai_chat_messages" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_chat_msg_created" ON "ai_chat_messages" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_ensemble_config_product" ON "ai_ensemble_configs" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_ensemble_config_enabled" ON "ai_ensemble_configs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_image_emb_inspection" ON "ai_image_embeddings" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_image_emb_measurement" ON "ai_image_embeddings" USING btree ("measurementResultId");--> statement-breakpoint
CREATE INDEX "idx_image_emb_model" ON "ai_image_embeddings" USING btree ("modelCode");--> statement-breakpoint
CREATE INDEX "idx_image_emb_machine" ON "ai_image_embeddings" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_image_emb_product" ON "ai_image_embeddings" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_image_emb_label" ON "ai_image_embeddings" USING btree ("label");--> statement-breakpoint
CREATE INDEX "idx_image_emb_created" ON "ai_image_embeddings" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_label_queue_status" ON "ai_label_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_label_queue_model" ON "ai_label_queue" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_label_queue_priority" ON "ai_label_queue" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_label_queue_machine" ON "ai_label_queue" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_label_queue_product" ON "ai_label_queue" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_label_queue_assigned" ON "ai_label_queue" USING btree ("assignedTo");--> statement-breakpoint
CREATE INDEX "idx_label_queue_created" ON "ai_label_queue" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_label_queue_confidence" ON "ai_label_queue" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "idx_ai_models_code" ON "ai_models" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_ai_models_type" ON "ai_models" USING btree ("modelType");--> statement-breakpoint
CREATE INDEX "idx_ai_models_format" ON "ai_models" USING btree ("format");--> statement-breakpoint
CREATE INDEX "idx_ai_models_status" ON "ai_models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_models_product" ON "ai_models" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_qg_config_machine" ON "ai_quality_gate_configs" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_qg_config_product" ON "ai_quality_gate_configs" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_qg_config_model" ON "ai_quality_gate_configs" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_qg_config_enabled" ON "ai_quality_gate_configs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_qg_result_inspection" ON "ai_quality_gate_results" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_qg_result_config" ON "ai_quality_gate_results" USING btree ("configId");--> statement-breakpoint
CREATE INDEX "idx_qg_result_decision" ON "ai_quality_gate_results" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "idx_qg_result_created" ON "ai_quality_gate_results" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_batch_items_job" ON "batch_inference_items" USING btree ("batchJobId");--> statement-breakpoint
CREATE INDEX "idx_batch_items_status" ON "batch_inference_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_batch_jobs_model" ON "batch_inference_jobs" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_batch_jobs_status" ON "batch_inference_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_batch_jobs_created" ON "batch_inference_jobs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_edge_deploy_model" ON "edge_deployments" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_edge_deploy_device" ON "edge_deployments" USING btree ("deviceId");--> statement-breakpoint
CREATE INDEX "idx_edge_deploy_machine" ON "edge_deployments" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_edge_deploy_status" ON "edge_deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_edge_sync_deployment" ON "edge_inference_sync" USING btree ("deploymentId");--> statement-breakpoint
CREATE INDEX "idx_edge_sync_device" ON "edge_inference_sync" USING btree ("deviceId");--> statement-breakpoint
CREATE INDEX "idx_edge_sync_synced" ON "edge_inference_sync" USING btree ("synced");--> statement-breakpoint
CREATE INDEX "idx_edge_sync_inferred" ON "edge_inference_sync" USING btree ("inferredAt");--> statement-breakpoint
CREATE INDEX "idx_image_annotations_image_url" ON "image_annotations" USING btree ("imageUrl");--> statement-breakpoint
CREATE INDEX "idx_image_annotations_inspection" ON "image_annotations" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_image_annotations_created_by" ON "image_annotations" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_image_annotations_created_at" ON "image_annotations" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_inference_results_model" ON "inference_results" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_inference_results_inspection" ON "inference_results" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_inference_results_measurement" ON "inference_results" USING btree ("measurementResultId");--> statement-breakpoint
CREATE INDEX "idx_inference_results_status" ON "inference_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_inference_results_created" ON "inference_results" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_drift_alert_model" ON "model_drift_alerts" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_drift_alert_type" ON "model_drift_alerts" USING btree ("alertType");--> statement-breakpoint
CREATE INDEX "idx_drift_alert_severity" ON "model_drift_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_drift_alert_acknowledged" ON "model_drift_alerts" USING btree ("acknowledged");--> statement-breakpoint
CREATE INDEX "idx_perf_snapshot_model" ON "model_performance_snapshots" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_perf_snapshot_period" ON "model_performance_snapshots" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "idx_perf_snapshot_created" ON "model_performance_snapshots" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_model_versions_model" ON "model_versions" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_model_versions_version" ON "model_versions" USING btree ("modelId","version");--> statement-breakpoint
CREATE INDEX "idx_model_versions_status" ON "model_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_training_datasets_model" ON "training_datasets" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_training_datasets_product" ON "training_datasets" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_training_datasets_status" ON "training_datasets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_training_jobs_model" ON "training_jobs" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_training_jobs_status" ON "training_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_training_jobs_created" ON "training_jobs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_product_documents_product" ON "product_documents" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_machine" ON "sync_logs" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_machine_code" ON "sync_logs" USING btree ("machineCode");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_product" ON "sync_logs" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_operation" ON "sync_logs" USING btree ("syncOperation");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_status" ON "sync_logs" USING btree ("syncStatus");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_created_at" ON "sync_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_machine_product" ON "sync_logs" USING btree ("machineId","productModelId");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ng_alert_settings_station_unique" ON "mqtt_ng_alert_settings" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_ng_alert_settings_enabled" ON "mqtt_ng_alert_settings" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_threshold" ON "mqtt_ng_rate_alert_history" USING btree ("thresholdId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_station" ON "mqtt_ng_rate_alert_history" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_point" ON "mqtt_ng_rate_alert_history" USING btree ("measurementPointId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_severity" ON "mqtt_ng_rate_alert_history" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_resolved" ON "mqtt_ng_rate_alert_history" USING btree ("isResolved");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_alert_triggered" ON "mqtt_ng_rate_alert_history" USING btree ("triggeredAt");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_threshold_station" ON "mqtt_ng_rate_thresholds" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_threshold_machine" ON "mqtt_ng_rate_thresholds" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_threshold_point" ON "mqtt_ng_rate_thresholds" USING btree ("measurementPointId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_threshold_product" ON "mqtt_ng_rate_thresholds" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_ng_rate_threshold_enabled" ON "mqtt_ng_rate_thresholds" USING btree ("isEnabled");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_qgta_template_line_unique" ON "quality_gate_template_assignments" USING btree ("templateId","lineId");--> statement-breakpoint
CREATE INDEX "idx_qgta_templateId" ON "quality_gate_template_assignments" USING btree ("templateId");--> statement-breakpoint
CREATE INDEX "idx_qgta_lineId" ON "quality_gate_template_assignments" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_qgt_standard" ON "quality_gate_templates" USING btree ("standard");--> statement-breakpoint
CREATE INDEX "idx_qgt_category" ON "quality_gate_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_qgt_createdBy" ON "quality_gate_templates" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_point_defs_last_modified" ON "measurement_point_defs" USING btree ("lastModifiedAt");--> statement-breakpoint
CREATE INDEX "idx_point_defs_product_modified" ON "measurement_point_defs" USING btree ("productModelId","lastModifiedAt");--> statement-breakpoint
CREATE INDEX "idx_point_defs_image_hash" ON "measurement_point_defs" USING btree ("imageHash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stats_machine_date" ON "daily_statistics" USING btree ("machineId","date");