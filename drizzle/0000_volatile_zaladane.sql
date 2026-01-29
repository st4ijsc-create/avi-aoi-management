CREATE TYPE "public"."accuracytrendenum" AS ENUM('IMPROVING', 'DECLINING', 'STABLE');--> statement-breakpoint
CREATE TYPE "public"."actionenum" AS ENUM('export', 'import', 'scheduled_export');--> statement-breakpoint
CREATE TYPE "public"."alerttypeenum" AS ENUM('yield_rate', 'ng_count', 'machine_status', 'machine_offline');--> statement-breakpoint
CREATE TYPE "public"."alerttypeenum_1" AS ENUM('DEFECT_SPIKE', 'YIELD_DROP', 'MACHINE_FAILURE', 'QUALITY_DEGRADATION', 'PATTERN_ANOMALY');--> statement-breakpoint
CREATE TYPE "public"."alerttypeenum_2" AS ENUM('connection_lost', 'reconnect_failed', 'high_reconnect_rate', 'long_disconnection');--> statement-breakpoint
CREATE TYPE "public"."analysistypeenum" AS ENUM('DEFECT_ANALYSIS', 'YIELD_ANALYSIS', 'QUALITY_ANALYSIS', 'MACHINE_ANALYSIS');--> statement-breakpoint
CREATE TYPE "public"."approvalstatusenum" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."categoryenum" AS ENUM('planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other');--> statement-breakpoint
CREATE TYPE "public"."changetypeenum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'ROLLBACK');--> statement-breakpoint
CREATE TYPE "public"."comparisonoperatorenum" AS ENUM('lt', 'lte', 'gt', 'gte', 'eq');--> statement-breakpoint
CREATE TYPE "public"."comparisonoperatorenum_1" AS ENUM('gt', 'lt', 'gte', 'lte');--> statement-breakpoint
CREATE TYPE "public"."comparisonoperatorenum_2" AS ENUM('GT', 'GTE', 'LT', 'LTE', 'EQ');--> statement-breakpoint
CREATE TYPE "public"."connectionstatusenum" AS ENUM('connected', 'disconnected', 'error', 'pending');--> statement-breakpoint
CREATE TYPE "public"."connectionstatusenum_1" AS ENUM('ONLINE', 'OFFLINE', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."datatypeenum" AS ENUM('STRING', 'NUMBER', 'BOOLEAN', 'JSON');--> statement-breakpoint
CREATE TYPE "public"."defaultqosenum" AS ENUM('0', '1', '2');--> statement-breakpoint
CREATE TYPE "public"."deliverystatusenum" AS ENUM('PENDING', 'DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."detectionmethodenum" AS ENUM('MANUAL', 'AUTO', 'MQTT');--> statement-breakpoint
CREATE TYPE "public"."devicetypeenum" AS ENUM('avi', 'aoi', 'spi', 'other');--> statement-breakpoint
CREATE TYPE "public"."errorcategoryenum" AS ENUM('FALSE_POSITIVE', 'FALSE_NEGATIVE', 'MISCLASSIFICATION', 'WRONG_LOCATION', 'WRONG_SEVERITY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."eventtypeenum" AS ENUM('connect', 'disconnect', 'error', 'reconnect');--> statement-breakpoint
CREATE TYPE "public"."eventtypeenum_1" AS ENUM('attempt', 'success', 'failure', 'max_attempts_reached');--> statement-breakpoint
CREATE TYPE "public"."exportformatenum" AS ENUM('CSV', 'JSON', 'EXCEL', 'PDF');--> statement-breakpoint
CREATE TYPE "public"."exportformatenum_1" AS ENUM('JSON', 'CSV', 'JSONL', 'PARQUET');--> statement-breakpoint
CREATE TYPE "public"."feedbacktypeenum" AS ENUM('CORRECT', 'INCORRECT', 'PARTIAL', 'UNSURE');--> statement-breakpoint
CREATE TYPE "public"."lastrunstatusenum" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."layoutlevelenum" AS ENUM('CORPORATION', 'FACTORY', 'WORKSHOP');--> statement-breakpoint
CREATE TYPE "public"."layouttypeenum" AS ENUM('2D', '3D');--> statement-breakpoint
CREATE TYPE "public"."lifecyclestatusenum" AS ENUM('development', 'active', 'eol', 'archived');--> statement-breakpoint
CREATE TYPE "public"."machinetypeenum" AS ENUM('AVI', 'AOI', 'AUTOMATION');--> statement-breakpoint
CREATE TYPE "public"."maintenanceurgencyenum" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."mappingtypeenum" AS ENUM('AUTO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."measurementtypeenum" AS ENUM('DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'COLOR', 'SURFACE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."messageformatenum" AS ENUM('json', 'xml', 'csv', 'binary');--> statement-breakpoint
CREATE TYPE "public"."messagetypeenum" AS ENUM('NG_ALERT', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."metrictypeenum" AS ENUM('FPY', 'FY', 'NTF', 'UPH');--> statement-breakpoint
CREATE TYPE "public"."operationstatusenum" AS ENUM('running', 'stopped', 'error', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."originalresultenum" AS ENUM('OK', 'NG');--> statement-breakpoint
CREATE TYPE "public"."overallresultenum" AS ENUM('OK', 'NG', 'NTF');--> statement-breakpoint
CREATE TYPE "public"."periodtypeenum" AS ENUM('HOUR', 'SHIFT', 'DAY', 'WEEK', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."periodtypeenum_1" AS ENUM('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."presettypeenum" AS ENUM('system', 'shared', 'user');--> statement-breakpoint
CREATE TYPE "public"."priorityenum" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."processtypeenum" AS ENUM('SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."processtypeenum_1" AS ENUM('SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'INSPECTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."protocolenum" AS ENUM('websocket', 'tcp', 'http');--> statement-breakpoint
CREATE TYPE "public"."protocolenum_1" AS ENUM('mqtt', 'mqtts', 'ws', 'wss');--> statement-breakpoint
CREATE TYPE "public"."reportformatenum" AS ENUM('HTML', 'PDF', 'EXCEL');--> statement-breakpoint
CREATE TYPE "public"."reporttypeenum" AS ENUM('NG_VISUAL', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'MONTHLY_SUMMARY', 'CUSTOM', 'OEE_REPORT', 'MACHINE_HEALTH');--> statement-breakpoint
CREATE TYPE "public"."resultfilterenum" AS ENUM('ALL', 'OK', 'NG', 'NTF');--> statement-breakpoint
CREATE TYPE "public"."roleenum" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."ruletypeenum" AS ENUM('LATENCY_THRESHOLD', 'BROKER_DISCONNECT', 'MESSAGE_FAILURE_RATE', 'THROUGHPUT_LOW', 'THROUGHPUT_HIGH', 'CLIENT_OFFLINE');--> statement-breakpoint
CREATE TYPE "public"."scheduleenum" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."scheduleenum_1" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."severityenum" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."shadowenum" AS ENUM('none', 'sm', 'md', 'lg', 'xl');--> statement-breakpoint
CREATE TYPE "public"."statusenum" AS ENUM('pending', 'in_progress', 'completed', 'cancelled', 'paused');--> statement-breakpoint
CREATE TYPE "public"."statusenum_1" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."statusenum_10" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UPLOADED');--> statement-breakpoint
CREATE TYPE "public"."statusenum_11" AS ENUM('connected', 'disconnected', 'connecting', 'error', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."statusenum_2" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."statusenum_3" AS ENUM('SUCCESS', 'FAILED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."statusenum_4" AS ENUM('success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."statusenum_5" AS ENUM('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."statusenum_6" AS ENUM('COMPLETED', 'IN_PROGRESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."statusenum_7" AS ENUM('SUCCESS', 'FAILED', 'PENDING', 'RUNNING');--> statement-breakpoint
CREATE TYPE "public"."statusenum_8" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."statusenum_9" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'REVIEWED');--> statement-breakpoint
CREATE TYPE "public"."storagetypeenum" AS ENUM('local', 's3');--> statement-breakpoint
CREATE TYPE "public"."suggestiontypeenum" AS ENUM('DEFECT_CLASSIFICATION', 'ROOT_CAUSE', 'CORRECTIVE_ACTION', 'QUALITY_PREDICTION', 'PROCESS_OPTIMIZATION');--> statement-breakpoint
CREATE TYPE "public"."summarytypeenum" AS ENUM('DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."targettypeenum" AS ENUM('machine', 'station', 'factory');--> statement-breakpoint
CREATE TYPE "public"."templatetypeenum" AS ENUM('system', 'shared');--> statement-breakpoint
CREATE TYPE "public"."templatetypeenum_1" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."themeenum" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TYPE "public"."timerangetypeenum" AS ENUM('LAST_24H', 'LAST_7D', 'LAST_30D', 'LAST_MONTH', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."typeenum" AS ENUM('ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS');--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"suggestionId" integer NOT NULL,
	"feedbackType" "feedbacktypeenum" NOT NULL,
	"accuracy" integer,
	"correctedValue" text,
	"correctionNotes" text,
	"errorCategory" "errorcategoryenum",
	"includedInTraining" boolean DEFAULT false NOT NULL,
	"trainingBatchId" varchar(100),
	"feedbackBy" integer NOT NULL,
	"feedbackByName" varchar(255),
	"feedbackAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelName" varchar(100) NOT NULL,
	"modelVersion" varchar(50) NOT NULL,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"totalSuggestions" integer DEFAULT 0 NOT NULL,
	"reviewedSuggestions" integer DEFAULT 0 NOT NULL,
	"correctCount" integer DEFAULT 0 NOT NULL,
	"incorrectCount" integer DEFAULT 0 NOT NULL,
	"partialCount" integer DEFAULT 0 NOT NULL,
	"accuracy" numeric(5, 4),
	"metricsByType" json,
	"errorBreakdown" json,
	"accuracyTrend" "accuracytrendenum" DEFAULT 'STABLE',
	"generatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer NOT NULL,
	"measurementResultId" integer,
	"suggestionType" "suggestiontypeenum" NOT NULL,
	"suggestion" text NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"reasoning" text,
	"alternatives" json,
	"modelVersion" varchar(50) NOT NULL,
	"modelName" varchar(100) NOT NULL,
	"status" "statusenum_9" DEFAULT 'PENDING' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_training_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batchId" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"feedbackCount" integer DEFAULT 0 NOT NULL,
	"correctSamples" integer DEFAULT 0 NOT NULL,
	"incorrectSamples" integer DEFAULT 0 NOT NULL,
	"exportFormat" "exportformatenum_1" DEFAULT 'JSONL' NOT NULL,
	"exportUrl" text,
	"status" "statusenum_10" DEFAULT 'PENDING' NOT NULL,
	"targetModelName" varchar(100),
	"targetModelVersion" varchar(50),
	"createdBy" integer NOT NULL,
	"createdByName" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "ai_training_batches_batchId_unique" UNIQUE("batchId")
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"alertSettingId" integer NOT NULL,
	"triggeredValue" numeric(10, 2) NOT NULL,
	"message" text NOT NULL,
	"sentEmail" boolean DEFAULT false NOT NULL,
	"sentSms" boolean DEFAULT false NOT NULL,
	"sentInApp" boolean DEFAULT false NOT NULL,
	"acknowledgedAt" timestamp,
	"acknowledgedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"alertType" "alerttypeenum" NOT NULL,
	"threshold" numeric(10, 2) NOT NULL,
	"comparisonOperator" "comparisonoperatorenum" DEFAULT 'lt' NOT NULL,
	"machineId" integer,
	"factoryId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"notifyEmail" boolean DEFAULT true NOT NULL,
	"notifySms" boolean DEFAULT false NOT NULL,
	"notifyInApp" boolean DEFAULT true NOT NULL,
	"cooldownMinutes" integer DEFAULT 60 NOT NULL,
	"lastTriggeredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation_comparison_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"productModelId" integer,
	"serialNumber" varchar(100),
	"machineId" integer,
	"inspectionIds" json NOT NULL,
	"comparisonResult" json,
	"detectedPatterns" json,
	"status" "statusenum_8" DEFAULT 'PENDING' NOT NULL,
	"errorMessage" text,
	"createdBy" integer NOT NULL,
	"createdByName" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"annotationId" integer NOT NULL,
	"imageUrl" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"annotations" json NOT NULL,
	"changeType" "changetypeenum" NOT NULL,
	"changeSummary" text,
	"changedBy" integer NOT NULL,
	"changedByName" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"userName" varchar(255),
	"action" varchar(100) NOT NULL,
	"entityType" varchar(100),
	"entityId" integer,
	"entityName" varchar(255),
	"details" text,
	"ipAddress" varchar(45),
	"userAgent" varchar(500),
	"status" "statusenum_2" DEFAULT 'success' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"isUsed" boolean DEFAULT false NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"action" "actionenum" NOT NULL,
	"categories" json NOT NULL,
	"status" "statusenum_4" NOT NULL,
	"fileSize" integer,
	"fileName" varchar(255),
	"fileUrl" text,
	"recordCount" integer,
	"errorMessage" text,
	"metadata" json,
	"ipAddress" varchar(45),
	"userAgent" text,
	"duration" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_statistics" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"factoryId" integer NOT NULL,
	"workshopId" integer NOT NULL,
	"date" timestamp NOT NULL,
	"totalCount" integer DEFAULT 0 NOT NULL,
	"okCount" integer DEFAULT 0 NOT NULL,
	"ngCount" integer DEFAULT 0 NOT NULL,
	"ntfCount" integer DEFAULT 0 NOT NULL,
	"yieldRate" numeric(5, 2),
	"avgCycleTime" numeric(10, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"templateType" "templatetypeenum" DEFAULT 'shared' NOT NULL,
	"widgets" json NOT NULL,
	"layout" json NOT NULL,
	"previewImageUrl" text,
	"isPublic" boolean DEFAULT true NOT NULL,
	"createdBy" integer NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widget_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"layoutName" varchar(100) DEFAULT 'default' NOT NULL,
	"widgets" json NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_heatmap_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"factoryId" integer,
	"workshopId" integer,
	"lineId" integer,
	"stationId" integer,
	"machineId" integer,
	"productModelId" integer,
	"periodType" "periodtypeenum_1" NOT NULL,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"gridWidth" integer NOT NULL,
	"gridHeight" integer NOT NULL,
	"heatmapGrid" json NOT NULL,
	"totalDefects" integer DEFAULT 0 NOT NULL,
	"maxDefectsInCell" integer DEFAULT 0 NOT NULL,
	"hotspots" json,
	"topLocations" json,
	"generatedAt" timestamp DEFAULT now() NOT NULL,
	"processingTimeMs" integer
);
--> statement-breakpoint
CREATE TABLE "downtime_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(50) NOT NULL,
	"category" "categoryenum" NOT NULL,
	"reason" varchar(255) NOT NULL,
	"detailedReason" text,
	"startTime" timestamp NOT NULL,
	"endTime" timestamp,
	"duration" integer,
	"detectionMethod" "detectionmethodenum" DEFAULT 'MANUAL' NOT NULL,
	"reportedBy" integer,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"resolution" text,
	"resolvedBy" integer,
	"resolvedAt" timestamp,
	"affectedUnits" integer DEFAULT 0,
	"estimatedCost" numeric(10, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) DEFAULT 'default' NOT NULL,
	"logoUrl" text,
	"companyName" varchar(255),
	"primaryColor" varchar(20) DEFAULT '#2563eb',
	"secondaryColor" varchar(20) DEFAULT '#64748b',
	"accentColor" varchar(20) DEFAULT '#10b981',
	"warningColor" varchar(20) DEFAULT '#f59e0b',
	"dangerColor" varchar(20) DEFAULT '#ef4444',
	"backgroundColor" varchar(20) DEFAULT '#f8fafc',
	"fontFamily" varchar(100) DEFAULT 'Arial, sans-serif',
	"footerText" text,
	"footerLinks" text,
	"contactEmail" varchar(255),
	"contactPhone" varchar(50),
	"contactAddress" text,
	"socialLinks" text,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"createdBy" integer
);
--> statement-breakpoint
CREATE TABLE "factories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"address" text,
	"region" varchar(100),
	"country" varchar(100),
	"mapPositionX" numeric(10, 4),
	"mapPositionY" numeric(10, 4),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "factories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "factory_layouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"factoryId" integer,
	"workshopId" integer,
	"layoutLevel" "layoutlevelenum" DEFAULT 'WORKSHOP' NOT NULL,
	"name" varchar(255) NOT NULL,
	"layoutType" "layouttypeenum" DEFAULT '2D' NOT NULL,
	"layoutData" text,
	"width" integer DEFAULT 1000 NOT NULL,
	"height" integer DEFAULT 800 NOT NULL,
	"depth" integer DEFAULT 500,
	"backgroundImageUrl" text,
	"model3dUrl" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"layoutId" integer NOT NULL,
	"factoryId" integer NOT NULL,
	"positionX" integer NOT NULL,
	"positionY" integer NOT NULL,
	"positionZ" integer DEFAULT 0,
	"width" integer DEFAULT 300 NOT NULL,
	"height" integer DEFAULT 200 NOT NULL,
	"depth" integer DEFAULT 150,
	"rotation" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_export_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduleId" integer NOT NULL,
	"status" "statusenum_7" DEFAULT 'PENDING' NOT NULL,
	"recordCount" integer DEFAULT 0 NOT NULL,
	"fileSize" integer DEFAULT 0 NOT NULL,
	"fileUrl" text,
	"recipientCount" integer DEFAULT 0 NOT NULL,
	"deliveredCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"processingTimeMs" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_export_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"scheduleType" "scheduleenum" DEFAULT 'DAILY' NOT NULL,
	"scheduleTime" varchar(10) DEFAULT '08:00' NOT NULL,
	"scheduleDayOfWeek" integer,
	"scheduleDayOfMonth" integer,
	"exportFormat" "exportformatenum" DEFAULT 'CSV' NOT NULL,
	"factoryId" integer,
	"workshopId" integer,
	"lineId" integer,
	"machineId" integer,
	"productModelId" integer,
	"resultFilter" "resultfilterenum" DEFAULT 'ALL' NOT NULL,
	"timeRangeType" timerangetypeenum DEFAULT 'LAST_24H' NOT NULL,
	"customDays" integer,
	"recipients" json NOT NULL,
	"includeImages" boolean DEFAULT false NOT NULL,
	"includeAnnotations" boolean DEFAULT true NOT NULL,
	"includeMeasurements" boolean DEFAULT true NOT NULL,
	"includeSummaryStats" boolean DEFAULT true NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastRunAt" timestamp,
	"lastRunStatus" "statusenum_3" DEFAULT 'PENDING',
	"lastRunError" text,
	"nextRunAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_process_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer NOT NULL,
	"processId" integer NOT NULL,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"cycleTimeTarget" numeric(10, 2),
	"stationId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_product_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer NOT NULL,
	"productModelId" integer NOT NULL,
	"productionOrderId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"startDate" timestamp,
	"endDate" timestamp,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"stationId" integer,
	"cycleTimeTarget" numeric(10, 2),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_health_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(50) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"healthScore" integer NOT NULL,
	"oeeScore" integer NOT NULL,
	"uptimeScore" integer NOT NULL,
	"errorRateScore" integer NOT NULL,
	"cycleTimeScore" integer NOT NULL,
	"currentOEE" integer,
	"uptimePercentage" integer,
	"errorCount" integer,
	"cycleTimeVariance" numeric(10, 2),
	"predictedFailureRisk" integer,
	"recommendedMaintenanceDate" timestamp,
	"maintenanceUrgency" "maintenanceurgencyenum",
	"calculationMethod" varchar(50) DEFAULT 'WEIGHTED' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_heartbeats" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"ipAddress" varchar(45),
	"status" "operationstatusenum" DEFAULT 'running' NOT NULL,
	"cpuUsage" numeric(5, 2),
	"memoryUsage" numeric(5, 2),
	"diskUsage" numeric(5, 2),
	"temperature" numeric(5, 2),
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"layoutId" integer NOT NULL,
	"machineId" integer NOT NULL,
	"positionX" integer NOT NULL,
	"positionY" integer NOT NULL,
	"positionZ" integer DEFAULT 0,
	"width" integer DEFAULT 100 NOT NULL,
	"height" integer DEFAULT 80 NOT NULL,
	"depth" integer DEFAULT 60,
	"rotation" integer DEFAULT 0,
	"rotationY" integer DEFAULT 0,
	"rotationZ" integer DEFAULT 0,
	"scale" numeric(5, 2) DEFAULT '1.00',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_status_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"status" "statusenum_1" NOT NULL,
	"ipAddress" varchar(45),
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"duration" integer,
	"notificationSent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" serial PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"machineType" "machinetypeenum" NOT NULL,
	"model" varchar(100),
	"manufacturer" varchar(100),
	"apiKey" varchar(128) NOT NULL,
	"description" text,
	"image2DUrl" text,
	"image2DKey" varchar(255),
	"image3DUrl" text,
	"image3DKey" varchar(255),
	"layoutPositionX" numeric(10, 4),
	"layoutPositionY" numeric(10, 4),
	"isActive" boolean DEFAULT true NOT NULL,
	"lastHeartbeat" timestamp,
	"operationStatus" "operationstatusenum" DEFAULT 'stopped' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machines_code_unique" UNIQUE("code"),
	CONSTRAINT "machines_apiKey_unique" UNIQUE("apiKey")
);
--> statement-breakpoint
CREATE TABLE "manual_machine_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"ipAddress" varchar(45) NOT NULL,
	"port" integer DEFAULT 8080 NOT NULL,
	"protocol" "protocolenum" DEFAULT 'websocket' NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"lastConnectionAttempt" timestamp,
	"lastSuccessfulConnection" timestamp,
	"connectionStatus" "connectionstatusenum" DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"retryCount" integer DEFAULT 0 NOT NULL,
	"maxRetries" integer DEFAULT 5 NOT NULL,
	"retryIntervalSeconds" integer DEFAULT 30 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_point_defs" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"machineId" integer,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"measurementType" "measurementtypeenum" NOT NULL,
	"unit" varchar(20),
	"lowerLimit" numeric(15, 6),
	"upperLimit" numeric(15, 6),
	"nominalValue" numeric(15, 6),
	"positionX" integer NOT NULL,
	"positionY" integer NOT NULL,
	"radius" integer DEFAULT 20 NOT NULL,
	"referenceImageUrl" text,
	"referenceImageKey" varchar(255),
	"cropWidth" integer DEFAULT 100 NOT NULL,
	"cropHeight" integer DEFAULT 100 NOT NULL,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"workstationId" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_point_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"points" json NOT NULL,
	"pointCount" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_point_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "measurement_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer NOT NULL,
	"pointDefId" integer NOT NULL,
	"measuredValue" numeric(15, 6),
	"measuredValueText" varchar(255),
	"result" "overallresultenum" NOT NULL,
	"imageUrl" text,
	"imageKey" varchar(255),
	"remark" text,
	"aiAnalysisResult" text,
	"aiConfidence" numeric(5, 4),
	"aiComparisonScore" numeric(5, 4),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_alert_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer,
	"connectionLostThreshold" integer DEFAULT 5 NOT NULL,
	"reconnectFailedThreshold" integer DEFAULT 10 NOT NULL,
	"highReconnectRateThreshold" integer DEFAULT 20 NOT NULL,
	"longDisconnectionThreshold" integer DEFAULT 30 NOT NULL,
	"enableEmailNotification" boolean DEFAULT false NOT NULL,
	"enablePushNotification" boolean DEFAULT true NOT NULL,
	"notificationEmails" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruleId" integer NOT NULL,
	"ruleName" varchar(255) NOT NULL,
	"ruleType" varchar(50) NOT NULL,
	"triggeredValue" numeric(10, 2) NOT NULL,
	"thresholdValue" numeric(10, 2) NOT NULL,
	"message" text NOT NULL,
	"notificationSent" boolean DEFAULT false NOT NULL,
	"notificationError" text,
	"isResolved" boolean DEFAULT false NOT NULL,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"resolutionNote" text,
	"triggeredAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"ruleType" "ruletypeenum" NOT NULL,
	"thresholdValue" numeric(10, 2) NOT NULL,
	"thresholdUnit" varchar(50) DEFAULT 'ms' NOT NULL,
	"comparisonOperator" "comparisonoperatorenum_2" DEFAULT 'GT' NOT NULL,
	"timeWindowMinutes" integer DEFAULT 5 NOT NULL,
	"notifyOwner" boolean DEFAULT true NOT NULL,
	"notifyEmail" boolean DEFAULT false NOT NULL,
	"notifyMqtt" boolean DEFAULT false NOT NULL,
	"cooldownMinutes" integer DEFAULT 15 NOT NULL,
	"lastTriggeredAt" timestamp,
	"categoryId" integer,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_client_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"brokerUrl" varchar(500) NOT NULL,
	"port" integer DEFAULT 1883 NOT NULL,
	"protocol" "protocolenum_1" DEFAULT 'mqtt' NOT NULL,
	"username" varchar(255),
	"password" varchar(255),
	"clientIdPrefix" varchar(100),
	"useTls" boolean DEFAULT false NOT NULL,
	"tlsCertPath" text,
	"tlsKeyPath" text,
	"tlsCaPath" text,
	"rejectUnauthorized" boolean DEFAULT true NOT NULL,
	"keepAlive" integer DEFAULT 60 NOT NULL,
	"connectTimeout" integer DEFAULT 30000 NOT NULL,
	"reconnectPeriod" integer DEFAULT 5000 NOT NULL,
	"cleanSession" boolean DEFAULT true NOT NULL,
	"maxReconnectAttempts" integer DEFAULT 10 NOT NULL,
	"reconnectBackoffMultiplier" numeric(3, 1) DEFAULT '1.5' NOT NULL,
	"maxReconnectDelay" integer DEFAULT 60000 NOT NULL,
	"autoReconnect" boolean DEFAULT true NOT NULL,
	"defaultQos" "defaultqosenum" DEFAULT '1' NOT NULL,
	"subscribeTopics" json DEFAULT '[]'::json,
	"publishTopics" json DEFAULT '[]'::json,
	"messageRetain" boolean DEFAULT false NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"clientId" varchar(128) NOT NULL,
	"deviceId" varchar(128) NOT NULL,
	"deviceName" varchar(255),
	"deviceModel" varchar(100),
	"osVersion" varchar(50),
	"appVersion" varchar(50),
	"stationId" integer,
	"processId" integer,
	"approvalStatus" "approvalstatusenum" DEFAULT 'PENDING' NOT NULL,
	"approvedBy" integer,
	"approvedAt" timestamp,
	"rejectionReason" text,
	"mappingType" "mappingtypeenum" DEFAULT 'MANUAL' NOT NULL,
	"autoReconnect" boolean DEFAULT true NOT NULL,
	"connectionStatus" "connectionstatusenum_1" DEFAULT 'OFFLINE' NOT NULL,
	"lastConnectedAt" timestamp,
	"lastDisconnectedAt" timestamp,
	"lastHeartbeat" timestamp,
	"receiveNGAlerts" boolean DEFAULT true NOT NULL,
	"receiveDailySummary" boolean DEFAULT true NOT NULL,
	"receiveWeeklySummary" boolean DEFAULT true NOT NULL,
	"fcmToken" varchar(500),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mqtt_clients_clientId_unique" UNIQUE("clientId"),
	CONSTRAINT "mqtt_clients_deviceId_unique" UNIQUE("deviceId")
);
--> statement-breakpoint
CREATE TABLE "mqtt_connection_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer NOT NULL,
	"assignmentId" integer,
	"targetType" "targettypeenum",
	"targetId" integer,
	"alertType" "alerttypeenum_2" NOT NULL,
	"severity" "severityenum" DEFAULT 'warning' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"triggeredAt" timestamp DEFAULT now() NOT NULL,
	"acknowledgedAt" timestamp,
	"acknowledgedBy" integer,
	"resolvedAt" timestamp,
	"thresholdMinutes" integer DEFAULT 5,
	"isAcknowledged" boolean DEFAULT false NOT NULL,
	"isResolved" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_connection_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer,
	"assignmentId" integer,
	"clientId" varchar(255) NOT NULL,
	"brokerUrl" varchar(500) NOT NULL,
	"eventType" "eventtypeenum" NOT NULL,
	"eventMessage" text,
	"errorCode" varchar(50),
	"ipAddress" varchar(45),
	"userAgent" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_connection_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer NOT NULL,
	"assignmentId" integer,
	"targetType" "targettypeenum",
	"targetId" integer,
	"status" "statusenum_11" DEFAULT 'unknown' NOT NULL,
	"clientId" varchar(255),
	"brokerUrl" varchar(500),
	"connectedAt" timestamp,
	"disconnectedAt" timestamp,
	"lastHeartbeat" timestamp,
	"uptime" integer DEFAULT 0,
	"reconnectCount" integer DEFAULT 0 NOT NULL,
	"totalConnectionTime" integer DEFAULT 0,
	"lastErrorMessage" text,
	"lastErrorCode" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_error_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"summaryType" "summarytypeenum" NOT NULL,
	"summaryDate" timestamp NOT NULL,
	"stationId" integer NOT NULL,
	"processId" integer,
	"measurementPointId" integer,
	"totalInspections" integer DEFAULT 0 NOT NULL,
	"totalNG" integer DEFAULT 0 NOT NULL,
	"totalNTF" integer DEFAULT 0 NOT NULL,
	"ngRate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"topNGPoints" json,
	"sentToClients" boolean DEFAULT false NOT NULL,
	"sentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_message_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(255) NOT NULL,
	"machineCode" varchar(50),
	"payload" json NOT NULL,
	"qos" integer DEFAULT 0 NOT NULL,
	"timestamp" timestamp NOT NULL,
	"messageSize" integer,
	"processingTime" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_message_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"messageType" "messagetypeenum" NOT NULL,
	"topic" varchar(255) NOT NULL,
	"payload" json NOT NULL,
	"targetClientId" integer,
	"stationId" integer,
	"inspectionId" integer,
	"deliveryStatus" "deliverystatusenum" DEFAULT 'PENDING' NOT NULL,
	"deliveredAt" timestamp,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_profile_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer NOT NULL,
	"targetType" "targettypeenum" NOT NULL,
	"targetId" integer NOT NULL,
	"overrideSettings" json,
	"isActive" boolean DEFAULT true NOT NULL,
	"assignedBy" integer,
	"assignedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_reconnect_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileId" integer NOT NULL,
	"assignmentId" integer,
	"targetType" "targettypeenum",
	"targetId" integer,
	"eventType" "eventtypeenum_1" NOT NULL,
	"attemptNumber" integer DEFAULT 1 NOT NULL,
	"reconnectDelay" integer,
	"connectionDuration" integer,
	"errorCode" varchar(100),
	"errorMessage" text,
	"clientId" varchar(255),
	"brokerUrl" varchar(500),
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"clientId" integer NOT NULL,
	"topic" varchar(255) NOT NULL,
	"qos" integer DEFAULT 1 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_topic_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"deviceType" "devicetypeenum" NOT NULL,
	"inspectionResultTopic" varchar(500),
	"ngAlertTopic" varchar(500),
	"statusTopic" varchar(500),
	"commandTopic" varchar(500),
	"heartbeatTopic" varchar(500),
	"messageFormat" "messageformatenum" DEFAULT 'json' NOT NULL,
	"sampleMessages" json,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" "typeenum" DEFAULT 'INFO' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"entityType" varchar(50),
	"entityId" integer,
	"actionUrl" varchar(500),
	"isRead" boolean DEFAULT false NOT NULL,
	"readAt" timestamp,
	"priority" "priorityenum" DEFAULT 'NORMAL' NOT NULL,
	"expiresAt" timestamp,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oee_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(50) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"periodType" "periodtypeenum" DEFAULT 'HOUR' NOT NULL,
	"availability" integer NOT NULL,
	"performance" integer NOT NULL,
	"quality" integer NOT NULL,
	"oee" integer NOT NULL,
	"plannedTime" integer NOT NULL,
	"runTime" integer NOT NULL,
	"idealCycleTime" integer NOT NULL,
	"totalCount" integer NOT NULL,
	"goodCount" integer NOT NULL,
	"rejectCount" integer NOT NULL,
	"calculatedBy" varchar(50) DEFAULT 'AUTO' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oee_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer,
	"lineId" integer,
	"targetOEE" integer DEFAULT 8000 NOT NULL,
	"targetAvailability" integer DEFAULT 9000 NOT NULL,
	"targetPerformance" integer DEFAULT 9500 NOT NULL,
	"targetQuality" integer DEFAULT 9900 NOT NULL,
	"alertThreshold" integer DEFAULT 7000 NOT NULL,
	"criticalThreshold" integer DEFAULT 6000 NOT NULL,
	"effectiveFrom" timestamp DEFAULT now() NOT NULL,
	"effectiveTo" timestamp,
	"isActive" boolean DEFAULT true NOT NULL,
	"setBy" integer NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictive_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alertType" "alerttypeenum_1" NOT NULL,
	"severity" "maintenanceurgencyenum" DEFAULT 'MEDIUM' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"predictedValue" numeric(10, 4),
	"currentValue" numeric(10, 4),
	"threshold" numeric(10, 4),
	"confidenceScore" numeric(5, 2),
	"predictedTimeframe" varchar(50),
	"machineId" integer,
	"machineCode" varchar(50),
	"productModelId" integer,
	"productModelCode" varchar(50),
	"factoryId" integer,
	"aiAnalysis" json,
	"status" "statusenum_5" DEFAULT 'ACTIVE' NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"resolvedBy" integer,
	"resolvedAt" timestamp,
	"resolutionNotes" text,
	"notificationSent" boolean DEFAULT false NOT NULL,
	"notificationSentAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"processType" "processtypeenum_1" DEFAULT 'OTHER' NOT NULL,
	"cycleTimeTarget" numeric(10, 2),
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"color" varchar(20) DEFAULT '#3b82f6',
	"icon" varchar(50),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"parentId" integer,
	"color" varchar(20) DEFAULT '#3b82f6',
	"icon" varchar(50),
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"productCount" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"productModelId" integer,
	"corporateCode" varchar(50),
	"factoryCode" varchar(50),
	"serialNumber" varchar(100) NOT NULL,
	"productModel" varchar(100),
	"batchNumber" varchar(100),
	"overallResult" "overallresultenum" NOT NULL,
	"originalResult" "originalresultenum" NOT NULL,
	"ntfConfirmedBy" integer,
	"ntfConfirmedAt" timestamp,
	"ntfReason" text,
	"inspectionTime" timestamp NOT NULL,
	"cycleTime" numeric(10, 2),
	"notes" text,
	"tags" text,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"isArchived" boolean DEFAULT false,
	"archivedAt" timestamp,
	"archivedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_machine_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"machineId" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"categoryId" integer,
	"productLine" varchar(100),
	"variant" varchar(100),
	"lifecycleStatus" "lifecyclestatusenum" DEFAULT 'active' NOT NULL,
	"referenceImageUrl" text,
	"referenceImageKey" varchar(255),
	"imageWidth" integer,
	"imageHeight" integer,
	"targetYieldRate" numeric(5, 2),
	"minYieldRate" numeric(5, 2),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_models_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "production_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"workshopId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"capacityPerHour" integer,
	"maxConcurrentOrders" integer DEFAULT 1,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_order_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"factoryId" integer,
	"workshopId" integer,
	"productModelId" integer,
	"defaultTargetQuantity" integer DEFAULT 1000 NOT NULL,
	"defaultPriority" integer DEFAULT 0 NOT NULL,
	"defaultNotes" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderCode" varchar(100) NOT NULL,
	"companyCode" varchar(50) NOT NULL,
	"factoryId" integer NOT NULL,
	"workshopId" integer NOT NULL,
	"lineId" integer NOT NULL,
	"productModelId" integer NOT NULL,
	"targetQuantity" integer NOT NULL,
	"completedQuantity" integer DEFAULT 0 NOT NULL,
	"okQuantity" integer DEFAULT 0 NOT NULL,
	"ngQuantity" integer DEFAULT 0 NOT NULL,
	"ntfQuantity" integer DEFAULT 0 NOT NULL,
	"status" "statusenum" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"plannedStartDate" timestamp,
	"plannedEndDate" timestamp,
	"actualStartDate" timestamp,
	"actualEndDate" timestamp,
	"notes" text,
	"dependencies" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_orderCode_unique" UNIQUE("orderCode")
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"templateType" "templatetypeenum_1" NOT NULL,
	"sections" json NOT NULL,
	"emailSubjectTemplate" varchar(255),
	"emailBodyTemplate" text,
	"defaultSchedule" varchar(50),
	"isSystem" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_templates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "root_cause_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysisType" "analysistypeenum" NOT NULL,
	"machineId" integer,
	"machineCode" varchar(50),
	"productModelId" integer,
	"productModelCode" varchar(50),
	"factoryId" integer,
	"startDate" timestamp NOT NULL,
	"endDate" timestamp NOT NULL,
	"dataPointsAnalyzed" integer NOT NULL,
	"correlationMatrix" json,
	"topFactors" json NOT NULL,
	"aiInsights" json,
	"paretoData" json,
	"status" "statusenum_6" DEFAULT 'COMPLETED' NOT NULL,
	"errorMessage" text,
	"requestedBy" integer NOT NULL,
	"requestedByName" varchar(255),
	"processingTime" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"categories" json NOT NULL,
	"schedule" "scheduleenum_1" NOT NULL,
	"scheduleTime" varchar(5) NOT NULL,
	"scheduleDayOfWeek" integer,
	"scheduleDayOfMonth" integer,
	"retentionCount" integer DEFAULT 7 NOT NULL,
	"storageType" "storagetypeenum" DEFAULT 's3' NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"lastRunAt" timestamp,
	"lastRunStatus" "lastrunstatusenum",
	"nextRunAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_report_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"reportId" integer NOT NULL,
	"status" "statusenum_3" DEFAULT 'PENDING' NOT NULL,
	"recipientCount" integer DEFAULT 0 NOT NULL,
	"successCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"reportData" json,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"reportType" "reporttypeenum" DEFAULT 'NG_VISUAL' NOT NULL,
	"schedule" "scheduleenum" DEFAULT 'DAILY' NOT NULL,
	"scheduleTime" varchar(10) DEFAULT '08:00' NOT NULL,
	"scheduleDayOfWeek" integer,
	"scheduleDayOfMonth" integer,
	"recipients" json NOT NULL,
	"factoryId" integer,
	"workshopId" integer,
	"lineId" integer,
	"includeWorkstationHeatmap" boolean DEFAULT true NOT NULL,
	"includeTopNGPoints" boolean DEFAULT true NOT NULL,
	"includeTrendChart" boolean DEFAULT true NOT NULL,
	"includeComparison" boolean DEFAULT true NOT NULL,
	"reportFormat" "reportformatenum" DEFAULT 'HTML' NOT NULL,
	"logoUrl" varchar(500),
	"primaryColor" varchar(20) DEFAULT '#3b82f6',
	"footerText" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastSentAt" timestamp,
	"nextScheduledAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"factoryId" integer,
	"name" varchar(100) NOT NULL,
	"code" varchar(20) NOT NULL,
	"startHour" integer NOT NULL,
	"startMinute" integer DEFAULT 0 NOT NULL,
	"endHour" integer NOT NULL,
	"endMinute" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255) DEFAULT 'AVI/AOI Management System' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"configKey" varchar(100) NOT NULL,
	"configValue" text NOT NULL,
	"description" text,
	"dataType" "datatypeenum" DEFAULT 'STRING' NOT NULL,
	"isEditable" boolean DEFAULT true NOT NULL,
	"requiresRestart" boolean DEFAULT false NOT NULL,
	"updatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_configKey_unique" UNIQUE("configKey")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"settingKey" varchar(100) NOT NULL,
	"settingValue" text,
	"description" text,
	"category" varchar(50),
	"updatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_settingKey_unique" UNIQUE("settingKey")
);
--> statement-breakpoint
CREATE TABLE "template_marketplace" (
	"id" serial PRIMARY KEY NOT NULL,
	"templateId" integer NOT NULL,
	"publisherId" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100),
	"tags" json,
	"thumbnailUrl" text,
	"previewData" json,
	"downloadCount" integer DEFAULT 0 NOT NULL,
	"rating" numeric(2, 1) DEFAULT '0',
	"ratingCount" integer DEFAULT 0 NOT NULL,
	"isPublished" boolean DEFAULT true NOT NULL,
	"isFeatured" boolean DEFAULT false NOT NULL,
	"version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplaceId" integer NOT NULL,
	"userId" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"isVerified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_batch_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"batchId" varchar(100) NOT NULL,
	"userId" integer NOT NULL,
	"userName" varchar(255),
	"content" text NOT NULL,
	"parentId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_batch_tag_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"batchId" varchar(100) NOT NULL,
	"tagId" integer NOT NULL,
	"assignedBy" integer NOT NULL,
	"assignedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_batch_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#3b82f6' NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "training_batch_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_corporate_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"corporateCode" varchar(50) NOT NULL,
	"assignedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_factory_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"factoryCode" varchar(50) NOT NULL,
	"assignedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"emailEnabled" boolean DEFAULT true NOT NULL,
	"emailAlerts" boolean DEFAULT true NOT NULL,
	"emailReports" boolean DEFAULT true NOT NULL,
	"emailSystem" boolean DEFAULT true NOT NULL,
	"pushEnabled" boolean DEFAULT true NOT NULL,
	"pushAlerts" boolean DEFAULT true NOT NULL,
	"pushReports" boolean DEFAULT true NOT NULL,
	"pushSystem" boolean DEFAULT true NOT NULL,
	"inAppEnabled" boolean DEFAULT true NOT NULL,
	"inAppAlerts" boolean DEFAULT true NOT NULL,
	"inAppReports" boolean DEFAULT true NOT NULL,
	"inAppSystem" boolean DEFAULT true NOT NULL,
	"soundEnabled" boolean DEFAULT true NOT NULL,
	"quietHoursEnabled" boolean DEFAULT false NOT NULL,
	"quietHoursStart" varchar(10) DEFAULT '22:00',
	"quietHoursEnd" varchar(10) DEFAULT '07:00',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preferences_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"sessionToken" varchar(255) NOT NULL,
	"deviceName" varchar(255),
	"deviceType" varchar(50),
	"browser" varchar(100),
	"os" varchar(100),
	"ipAddress" varchar(45),
	"location" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"lastActivityAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_sessionToken_unique" UNIQUE("sessionToken")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"language" varchar(10) DEFAULT 'vi' NOT NULL,
	"theme" "themeenum" DEFAULT 'system' NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Ho_Chi_Minh',
	"dateFormat" varchar(20) DEFAULT 'DD/MM/YYYY',
	"timeFormat" varchar(10) DEFAULT '24h',
	"numberFormat" varchar(20) DEFAULT '1.234,56',
	"defaultDashboardTab" varchar(50) DEFAULT 'overview',
	"sidebarCollapsed" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"username" varchar(100),
	"passwordHash" varchar(255),
	"name" text,
	"email" varchar(320),
	"phone" varchar(20),
	"department" varchar(100),
	"position" varchar(100),
	"loginMethod" varchar(64),
	"role" "roleenum" DEFAULT 'user' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"two_factor_secret" varchar(255),
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "widget_style_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"backgroundColor" varchar(20) DEFAULT '#ffffff' NOT NULL,
	"textColor" varchar(20) DEFAULT '#1f2937' NOT NULL,
	"borderColor" varchar(20) DEFAULT '#e5e7eb' NOT NULL,
	"accentColor" varchar(20) DEFAULT '#3b82f6' NOT NULL,
	"borderRadius" varchar(20) DEFAULT '0.5rem' NOT NULL,
	"shadow" "shadowenum" DEFAULT 'sm' NOT NULL,
	"opacity" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"presetType" "presettypeenum" DEFAULT 'user' NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"createdBy" integer NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workshop_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"layoutId" integer NOT NULL,
	"workshopId" integer NOT NULL,
	"positionX" integer NOT NULL,
	"positionY" integer NOT NULL,
	"positionZ" integer DEFAULT 0,
	"width" integer DEFAULT 200 NOT NULL,
	"height" integer DEFAULT 150 NOT NULL,
	"depth" integer DEFAULT 100,
	"rotation" integer DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" serial PRIMARY KEY NOT NULL,
	"factoryId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"floorArea" numeric(10, 2),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"lineId" integer,
	"workshopId" integer,
	"factoryId" integer,
	"processType" "processtypeenum" DEFAULT 'OTHER',
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workstations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "yield_alert_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"metricType" "metrictypeenum" NOT NULL,
	"warningThreshold" numeric(10, 4) NOT NULL,
	"criticalThreshold" numeric(10, 4) NOT NULL,
	"targetValue" numeric(10, 4),
	"comparisonOperator" "comparisonoperatorenum_1" DEFAULT 'gte' NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"notifyOnWarning" boolean DEFAULT true NOT NULL,
	"notifyOnCritical" boolean DEFAULT true NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yield_threshold_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"thresholdId" integer NOT NULL,
	"metricType" "metrictypeenum" NOT NULL,
	"previousWarning" numeric(10, 4),
	"newWarning" numeric(10, 4) NOT NULL,
	"previousCritical" numeric(10, 4),
	"newCritical" numeric(10, 4) NOT NULL,
	"previousTarget" numeric(10, 4),
	"newTarget" numeric(10, 4),
	"changeReason" text,
	"changedBy" integer,
	"changedByName" varchar(255),
	"actualValueAtChange" numeric(10, 4),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_suggestion" ON "ai_feedback" USING btree ("suggestionId");--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_type" ON "ai_feedback" USING btree ("feedbackType");--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_training" ON "ai_feedback" USING btree ("includedInTraining");--> statement-breakpoint
CREATE INDEX "idx_ai_feedback_batch" ON "ai_feedback" USING btree ("trainingBatchId");--> statement-breakpoint
CREATE INDEX "idx_ai_metrics_model" ON "ai_model_metrics" USING btree ("modelName","modelVersion");--> statement-breakpoint
CREATE INDEX "idx_ai_metrics_period" ON "ai_model_metrics" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "idx_ai_suggestion_inspection" ON "ai_suggestions" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_ai_suggestion_type" ON "ai_suggestions" USING btree ("suggestionType");--> statement-breakpoint
CREATE INDEX "idx_ai_suggestion_status" ON "ai_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_suggestion_model" ON "ai_suggestions" USING btree ("modelName","modelVersion");--> statement-breakpoint
CREATE INDEX "idx_training_batch_id" ON "ai_training_batches" USING btree ("batchId");--> statement-breakpoint
CREATE INDEX "idx_training_batch_status" ON "ai_training_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_training_batch_created" ON "ai_training_batches" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_alert_history_setting" ON "alert_history" USING btree ("alertSettingId");--> statement-breakpoint
CREATE INDEX "idx_alert_history_created" ON "alert_history" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_alert_user" ON "alert_settings" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_alert_active" ON "alert_settings" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_alert_type" ON "alert_settings" USING btree ("alertType");--> statement-breakpoint
CREATE INDEX "idx_comparison_product" ON "annotation_comparison_sessions" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_comparison_serial" ON "annotation_comparison_sessions" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_comparison_machine" ON "annotation_comparison_sessions" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_comparison_status" ON "annotation_comparison_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_comparison_created" ON "annotation_comparison_sessions" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_annotation_history_annotation" ON "annotation_history" USING btree ("annotationId");--> statement-breakpoint
CREATE INDEX "idx_annotation_history_image" ON "annotation_history" USING btree ("imageUrl");--> statement-breakpoint
CREATE INDEX "idx_annotation_history_version" ON "annotation_history" USING btree ("annotationId","versionNumber");--> statement-breakpoint
CREATE INDEX "idx_annotation_history_created" ON "annotation_history" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_annotation_history_user" ON "annotation_history" USING btree ("changedBy");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_backup_codes_user" ON "backup_codes" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_backup_codes_code" ON "backup_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_backup_logs_user" ON "backup_logs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_backup_logs_action" ON "backup_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_backup_logs_status" ON "backup_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_backup_logs_created" ON "backup_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_stats_machine_date" ON "daily_statistics" USING btree ("machineId","date");--> statement-breakpoint
CREATE INDEX "idx_stats_factory_date" ON "daily_statistics" USING btree ("factoryId","date");--> statement-breakpoint
CREATE INDEX "idx_stats_workshop_date" ON "daily_statistics" USING btree ("workshopId","date");--> statement-breakpoint
CREATE INDEX "idx_stats_date" ON "daily_statistics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_dashboard_templates_type" ON "dashboard_templates" USING btree ("templateType");--> statement-breakpoint
CREATE INDEX "idx_dashboard_templates_public" ON "dashboard_templates" USING btree ("isPublic");--> statement-breakpoint
CREATE INDEX "idx_dashboard_templates_creator" ON "dashboard_templates" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_dashboard_templates_usage" ON "dashboard_templates" USING btree ("usageCount");--> statement-breakpoint
CREATE INDEX "idx_widget_layouts_user" ON "dashboard_widget_layouts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_widget_layouts_active" ON "dashboard_widget_layouts" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_widget_layouts_user_active" ON "dashboard_widget_layouts" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "idx_heatmap_factory" ON "defect_heatmap_data" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_heatmap_machine" ON "defect_heatmap_data" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_heatmap_product" ON "defect_heatmap_data" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_heatmap_period" ON "defect_heatmap_data" USING btree ("periodType");--> statement-breakpoint
CREATE INDEX "idx_heatmap_generated" ON "defect_heatmap_data" USING btree ("generatedAt");--> statement-breakpoint
CREATE INDEX "idx_downtime_machine" ON "downtime_events" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_downtime_machine_code" ON "downtime_events" USING btree ("machineCode");--> statement-breakpoint
CREATE INDEX "idx_downtime_category" ON "downtime_events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_downtime_start" ON "downtime_events" USING btree ("startTime");--> statement-breakpoint
CREATE INDEX "idx_downtime_end" ON "downtime_events" USING btree ("endTime");--> statement-breakpoint
CREATE INDEX "idx_downtime_machine_time" ON "downtime_events" USING btree ("machineId","startTime");--> statement-breakpoint
CREATE INDEX "idx_email_template_name" ON "email_template_config" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_email_template_default" ON "email_template_config" USING btree ("isDefault");--> statement-breakpoint
CREATE INDEX "idx_factories_code" ON "factories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_factories_active" ON "factories" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_layouts_factory" ON "factory_layouts" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_layouts_workshop" ON "factory_layouts" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_layouts_level" ON "factory_layouts" USING btree ("layoutLevel");--> statement-breakpoint
CREATE INDEX "idx_fac_positions_layout" ON "factory_positions" USING btree ("layoutId");--> statement-breakpoint
CREATE INDEX "idx_fac_positions_factory" ON "factory_positions" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_export_log_schedule" ON "history_export_logs" USING btree ("scheduleId");--> statement-breakpoint
CREATE INDEX "idx_export_log_status" ON "history_export_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_export_log_started" ON "history_export_logs" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "idx_export_schedule_type" ON "history_export_schedules" USING btree ("scheduleType");--> statement-breakpoint
CREATE INDEX "idx_export_schedule_active" ON "history_export_schedules" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_export_schedule_next" ON "history_export_schedules" USING btree ("nextRunAt");--> statement-breakpoint
CREATE INDEX "idx_export_schedule_creator" ON "history_export_schedules" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_lpa_process_line" ON "line_process_assignments" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_lpa_process" ON "line_process_assignments" USING btree ("processId");--> statement-breakpoint
CREATE INDEX "idx_lpa_station" ON "line_process_assignments" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_lpa_process_order" ON "line_process_assignments" USING btree ("orderIndex");--> statement-breakpoint
CREATE INDEX "idx_lpa_line" ON "line_product_assignments" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_lpa_product" ON "line_product_assignments" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_lpa_order" ON "line_product_assignments" USING btree ("productionOrderId");--> statement-breakpoint
CREATE INDEX "idx_stage_line" ON "line_stages" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_stage_code" ON "line_stages" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_stage_station" ON "line_stages" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_health_machine" ON "machine_health_history" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_health_machine_code" ON "machine_health_history" USING btree ("machineCode");--> statement-breakpoint
CREATE INDEX "idx_health_timestamp" ON "machine_health_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_health_score" ON "machine_health_history" USING btree ("healthScore");--> statement-breakpoint
CREATE INDEX "idx_health_machine_time" ON "machine_health_history" USING btree ("machineId","timestamp");--> statement-breakpoint
CREATE INDEX "idx_heartbeats_machine" ON "machine_heartbeats" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_heartbeats_timestamp" ON "machine_heartbeats" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_positions_layout" ON "machine_positions" USING btree ("layoutId");--> statement-breakpoint
CREATE INDEX "idx_positions_machine" ON "machine_positions" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_status_logs_machine" ON "machine_status_logs" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_status_logs_timestamp" ON "machine_status_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_status_logs_status" ON "machine_status_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_machines_station" ON "machines" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_machines_code" ON "machines" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_machines_apikey" ON "machines" USING btree ("apiKey");--> statement-breakpoint
CREATE INDEX "idx_manual_conn_machine" ON "manual_machine_connections" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_manual_conn_ip" ON "manual_machine_connections" USING btree ("ipAddress");--> statement-breakpoint
CREATE INDEX "idx_manual_conn_status" ON "manual_machine_connections" USING btree ("connectionStatus");--> statement-breakpoint
CREATE INDEX "idx_point_defs_product" ON "measurement_point_defs" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_point_defs_machine" ON "measurement_point_defs" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_point_defs_code" ON "measurement_point_defs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_templates_code" ON "measurement_point_templates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_templates_category" ON "measurement_point_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_templates_active" ON "measurement_point_templates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_results_inspection" ON "measurement_results" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_results_point" ON "measurement_results" USING btree ("pointDefId");--> statement-breakpoint
CREATE INDEX "idx_results_result" ON "measurement_results" USING btree ("result");--> statement-breakpoint
CREATE INDEX "idx_results_inspection_result" ON "measurement_results" USING btree ("inspectionId","result");--> statement-breakpoint
CREATE INDEX "idx_results_point_result" ON "measurement_results" USING btree ("pointDefId","result");--> statement-breakpoint
CREATE INDEX "idx_alert_config_profile" ON "mqtt_alert_config" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_alert_config_active" ON "mqtt_alert_config" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_history_rule" ON "mqtt_alert_history" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_history_type" ON "mqtt_alert_history" USING btree ("ruleType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_history_resolved" ON "mqtt_alert_history" USING btree ("isResolved");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_history_triggered" ON "mqtt_alert_history" USING btree ("triggeredAt");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_rules_type" ON "mqtt_alert_rules" USING btree ("ruleType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_rules_enabled" ON "mqtt_alert_rules" USING btree ("isEnabled");--> statement-breakpoint
CREATE INDEX "idx_mqtt_profiles_name" ON "mqtt_client_profiles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_mqtt_profiles_active" ON "mqtt_client_profiles" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_mqtt_profiles_default" ON "mqtt_client_profiles" USING btree ("isDefault");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_clientId" ON "mqtt_clients" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_deviceId" ON "mqtt_clients" USING btree ("deviceId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_station" ON "mqtt_clients" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_approval" ON "mqtt_clients" USING btree ("approvalStatus");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_connection" ON "mqtt_clients" USING btree ("connectionStatus");--> statement-breakpoint
CREATE INDEX "idx_mqtt_clients_active" ON "mqtt_clients" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_profile" ON "mqtt_connection_alerts" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_assignment" ON "mqtt_connection_alerts" USING btree ("assignmentId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_type" ON "mqtt_connection_alerts" USING btree ("alertType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_severity" ON "mqtt_connection_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_acknowledged" ON "mqtt_connection_alerts" USING btree ("isAcknowledged");--> statement-breakpoint
CREATE INDEX "idx_mqtt_alert_triggered" ON "mqtt_connection_alerts" USING btree ("triggeredAt");--> statement-breakpoint
CREATE INDEX "idx_mqtt_conn_logs_profile" ON "mqtt_connection_logs" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_conn_logs_client" ON "mqtt_connection_logs" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_conn_logs_event" ON "mqtt_connection_logs" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_conn_logs_timestamp" ON "mqtt_connection_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_conn_status_profile" ON "mqtt_connection_status" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_conn_status_assignment" ON "mqtt_connection_status" USING btree ("assignmentId");--> statement-breakpoint
CREATE INDEX "idx_conn_status_status" ON "mqtt_connection_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conn_status_target" ON "mqtt_connection_status" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "idx_error_summary_type" ON "mqtt_error_summary" USING btree ("summaryType");--> statement-breakpoint
CREATE INDEX "idx_error_summary_date" ON "mqtt_error_summary" USING btree ("summaryDate");--> statement-breakpoint
CREATE INDEX "idx_error_summary_station" ON "mqtt_error_summary" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_error_summary_sent" ON "mqtt_error_summary" USING btree ("sentToClients");--> statement-breakpoint
CREATE INDEX "idx_mqtt_history_topic" ON "mqtt_message_history" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_mqtt_history_machine" ON "mqtt_message_history" USING btree ("machineCode");--> statement-breakpoint
CREATE INDEX "idx_mqtt_history_timestamp" ON "mqtt_message_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_mqtt_history_topic_time" ON "mqtt_message_history" USING btree ("topic","timestamp");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_type" ON "mqtt_message_logs" USING btree ("messageType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_topic" ON "mqtt_message_logs" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_client" ON "mqtt_message_logs" USING btree ("targetClientId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_station" ON "mqtt_message_logs" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_status" ON "mqtt_message_logs" USING btree ("deliveryStatus");--> statement-breakpoint
CREATE INDEX "idx_mqtt_logs_created" ON "mqtt_message_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_mqtt_assignments_profile" ON "mqtt_profile_assignments" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_assignments_target" ON "mqtt_profile_assignments" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "idx_reconnect_profile" ON "mqtt_reconnect_logs" USING btree ("profileId");--> statement-breakpoint
CREATE INDEX "idx_reconnect_assignment" ON "mqtt_reconnect_logs" USING btree ("assignmentId");--> statement-breakpoint
CREATE INDEX "idx_reconnect_event" ON "mqtt_reconnect_logs" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "idx_reconnect_timestamp" ON "mqtt_reconnect_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_reconnect_target" ON "mqtt_reconnect_logs" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_subs_client" ON "mqtt_subscriptions" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "idx_mqtt_subs_topic" ON "mqtt_subscriptions" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_mqtt_templates_device" ON "mqtt_topic_templates" USING btree ("deviceType");--> statement-breakpoint
CREATE INDEX "idx_mqtt_templates_active" ON "mqtt_topic_templates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_notifications_type" ON "notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_notifications_read" ON "notifications" USING btree ("isRead");--> statement-breakpoint
CREATE INDEX "idx_notifications_priority" ON "notifications" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "notifications" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("userId","isRead");--> statement-breakpoint
CREATE INDEX "idx_oee_machine" ON "oee_metrics" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_oee_machine_code" ON "oee_metrics" USING btree ("machineCode");--> statement-breakpoint
CREATE INDEX "idx_oee_timestamp" ON "oee_metrics" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_oee_period" ON "oee_metrics" USING btree ("periodType");--> statement-breakpoint
CREATE INDEX "idx_oee_machine_time" ON "oee_metrics" USING btree ("machineId","timestamp");--> statement-breakpoint
CREATE INDEX "idx_oee_target_machine" ON "oee_targets" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_oee_target_line" ON "oee_targets" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_oee_target_active" ON "oee_targets" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_oee_target_effective" ON "oee_targets" USING btree ("effectiveFrom","effectiveTo");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_type" ON "predictive_alerts" USING btree ("alertType");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_severity" ON "predictive_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_status" ON "predictive_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_machine" ON "predictive_alerts" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_product" ON "predictive_alerts" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_factory" ON "predictive_alerts" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_created" ON "predictive_alerts" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_expires" ON "predictive_alerts" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "idx_processes_code" ON "processes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_processes_type" ON "processes" USING btree ("processType");--> statement-breakpoint
CREATE INDEX "idx_processes_order" ON "processes" USING btree ("orderIndex");--> statement-breakpoint
CREATE INDEX "idx_processes_active" ON "processes" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_product_categories_code" ON "product_categories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_product_categories_parent" ON "product_categories" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "idx_product_categories_order" ON "product_categories" USING btree ("orderIndex");--> statement-breakpoint
CREATE INDEX "idx_product_categories_active" ON "product_categories" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_inspections_machine" ON "product_inspections" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_inspections_serial" ON "product_inspections" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_inspections_time" ON "product_inspections" USING btree ("inspectionTime");--> statement-breakpoint
CREATE INDEX "idx_inspections_result" ON "product_inspections" USING btree ("overallResult");--> statement-breakpoint
CREATE INDEX "idx_inspections_product_model" ON "product_inspections" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_inspections_corporate" ON "product_inspections" USING btree ("corporateCode");--> statement-breakpoint
CREATE INDEX "idx_inspections_factory" ON "product_inspections" USING btree ("factoryCode");--> statement-breakpoint
CREATE INDEX "idx_inspections_machine_time" ON "product_inspections" USING btree ("machineId","inspectionTime");--> statement-breakpoint
CREATE INDEX "idx_inspections_corporate_factory" ON "product_inspections" USING btree ("corporateCode","factoryCode");--> statement-breakpoint
CREATE INDEX "idx_pm_mapping_product" ON "product_machine_mappings" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_pm_mapping_machine" ON "product_machine_mappings" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_product_models_code" ON "product_models" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_product_models_category" ON "product_models" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_product_models_category_id" ON "product_models" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "idx_product_models_lifecycle" ON "product_models" USING btree ("lifecycleStatus");--> statement-breakpoint
CREATE INDEX "idx_lines_workshop" ON "production_lines" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_lines_code" ON "production_lines" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_order_template_factory" ON "production_order_templates" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_order_template_workshop" ON "production_order_templates" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_order_template_product" ON "production_order_templates" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_order_template_active" ON "production_order_templates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_po_order_code" ON "production_orders" USING btree ("orderCode");--> statement-breakpoint
CREATE INDEX "idx_po_company" ON "production_orders" USING btree ("companyCode");--> statement-breakpoint
CREATE INDEX "idx_po_factory" ON "production_orders" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_po_workshop" ON "production_orders" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_po_line" ON "production_orders" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_po_product" ON "production_orders" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_po_status" ON "production_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_report_templates_code" ON "report_templates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_report_templates_type" ON "report_templates" USING btree ("templateType");--> statement-breakpoint
CREATE INDEX "idx_report_templates_active" ON "report_templates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_rca_type" ON "root_cause_analysis" USING btree ("analysisType");--> statement-breakpoint
CREATE INDEX "idx_rca_machine" ON "root_cause_analysis" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_rca_product" ON "root_cause_analysis" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_rca_factory" ON "root_cause_analysis" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_rca_status" ON "root_cause_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_rca_created" ON "root_cause_analysis" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_rca_date_range" ON "root_cause_analysis" USING btree ("startDate","endDate");--> statement-breakpoint
CREATE INDEX "idx_scheduled_backups_enabled" ON "scheduled_backups" USING btree ("isEnabled");--> statement-breakpoint
CREATE INDEX "idx_scheduled_backups_next_run" ON "scheduled_backups" USING btree ("nextRunAt");--> statement-breakpoint
CREATE INDEX "idx_report_logs_report" ON "scheduled_report_logs" USING btree ("reportId");--> statement-breakpoint
CREATE INDEX "idx_report_logs_status" ON "scheduled_report_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_report_logs_sent" ON "scheduled_report_logs" USING btree ("sentAt");--> statement-breakpoint
CREATE INDEX "idx_scheduled_reports_type" ON "scheduled_reports" USING btree ("reportType");--> statement-breakpoint
CREATE INDEX "idx_scheduled_reports_schedule" ON "scheduled_reports" USING btree ("schedule");--> statement-breakpoint
CREATE INDEX "idx_scheduled_reports_active" ON "scheduled_reports" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_scheduled_reports_next" ON "scheduled_reports" USING btree ("nextScheduledAt");--> statement-breakpoint
CREATE INDEX "idx_scheduled_reports_factory" ON "scheduled_reports" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_shift_factory" ON "shift_configs" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_shift_code" ON "shift_configs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_stations_line" ON "stations" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_stations_code" ON "stations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_system_config_key" ON "system_config" USING btree ("configKey");--> statement-breakpoint
CREATE INDEX "idx_system_settings_key" ON "system_settings" USING btree ("settingKey");--> statement-breakpoint
CREATE INDEX "idx_system_settings_category" ON "system_settings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_marketplace_publisher" ON "template_marketplace" USING btree ("publisherId");--> statement-breakpoint
CREATE INDEX "idx_marketplace_category" ON "template_marketplace" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_marketplace_published" ON "template_marketplace" USING btree ("isPublished");--> statement-breakpoint
CREATE INDEX "idx_marketplace_featured" ON "template_marketplace" USING btree ("isFeatured");--> statement-breakpoint
CREATE INDEX "idx_marketplace_rating" ON "template_marketplace" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_marketplace_downloads" ON "template_marketplace" USING btree ("downloadCount");--> statement-breakpoint
CREATE INDEX "idx_reviews_marketplace" ON "template_reviews" USING btree ("marketplaceId");--> statement-breakpoint
CREATE INDEX "idx_reviews_user" ON "template_reviews" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_reviews_rating" ON "template_reviews" USING btree ("rating");--> statement-breakpoint
CREATE INDEX "idx_batch_comment_batch" ON "training_batch_comments" USING btree ("batchId");--> statement-breakpoint
CREATE INDEX "idx_batch_comment_user" ON "training_batch_comments" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_batch_comment_parent" ON "training_batch_comments" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "idx_batch_tag_assign_batch" ON "training_batch_tag_assignments" USING btree ("batchId");--> statement-breakpoint
CREATE INDEX "idx_batch_tag_assign_tag" ON "training_batch_tag_assignments" USING btree ("tagId");--> statement-breakpoint
CREATE INDEX "idx_batch_tag_name" ON "training_batch_tags" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_user_corporate_user" ON "user_corporate_assignments" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_corporate_code" ON "user_corporate_assignments" USING btree ("corporateCode");--> statement-breakpoint
CREATE INDEX "idx_user_corporate_unique" ON "user_corporate_assignments" USING btree ("userId","corporateCode");--> statement-breakpoint
CREATE INDEX "idx_user_factory_user" ON "user_factory_assignments" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_factory_code" ON "user_factory_assignments" USING btree ("factoryCode");--> statement-breakpoint
CREATE INDEX "idx_user_factory_unique" ON "user_factory_assignments" USING btree ("userId","factoryCode");--> statement-breakpoint
CREATE INDEX "idx_notif_prefs_user" ON "user_notification_preferences" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_user" ON "user_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_token" ON "user_sessions" USING btree ("sessionToken");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_active" ON "user_sessions" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_expires" ON "user_sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "idx_user_settings_user" ON "user_settings" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_settings_language" ON "user_settings" USING btree ("language");--> statement-breakpoint
CREATE INDEX "idx_users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_active" ON "users" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_widget_presets_type" ON "widget_style_presets" USING btree ("presetType");--> statement-breakpoint
CREATE INDEX "idx_widget_presets_public" ON "widget_style_presets" USING btree ("isPublic");--> statement-breakpoint
CREATE INDEX "idx_widget_presets_creator" ON "widget_style_presets" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_widget_presets_name" ON "widget_style_presets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_ws_positions_layout" ON "workshop_positions" USING btree ("layoutId");--> statement-breakpoint
CREATE INDEX "idx_ws_positions_workshop" ON "workshop_positions" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_workshops_factory" ON "workshops" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_workshops_code" ON "workshops" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_workstations_code" ON "workstations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_workstations_line" ON "workstations" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_workstations_workshop" ON "workstations" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_workstations_factory" ON "workstations" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_yield_thresholds_type" ON "yield_alert_thresholds" USING btree ("metricType");--> statement-breakpoint
CREATE INDEX "idx_yield_thresholds_enabled" ON "yield_alert_thresholds" USING btree ("isEnabled");--> statement-breakpoint
CREATE INDEX "idx_threshold_history_threshold" ON "yield_threshold_history" USING btree ("thresholdId");--> statement-breakpoint
CREATE INDEX "idx_threshold_history_type" ON "yield_threshold_history" USING btree ("metricType");--> statement-breakpoint
CREATE INDEX "idx_threshold_history_date" ON "yield_threshold_history" USING btree ("createdAt");