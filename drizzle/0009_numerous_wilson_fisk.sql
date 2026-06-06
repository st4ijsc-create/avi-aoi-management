CREATE TYPE "public"."aipendingactionstatus" AS ENUM('proposed', 'confirmed', 'executed', 'denied', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."complianceviewenum" AS ENUM('CFR21_PART11', 'IATF16949', 'ISO9001', 'ISO17025', 'ISO50001');--> statement-breakpoint
CREATE TYPE "public"."drcheckstatusenum" AS ENUM('passed', 'failed', 'skipped', 'running');--> statement-breakpoint
CREATE TYPE "public"."energysourceenum" AS ENUM('electricity', 'compressed_air', 'water', 'gas', 'steam', 'other');--> statement-breakpoint
CREATE TYPE "public"."lotdispositionenum" AS ENUM('release', 'rework', 'scrap', 'return', 'hold', 'quarantine');--> statement-breakpoint
CREATE TYPE "public"."maintenancescheduletypeenum" AS ENUM('TIME_BASED', 'USAGE_BASED', 'CONDITION_BASED', 'PREDICTIVE');--> statement-breakpoint
CREATE TYPE "public"."schedulerunstatusenum" AS ENUM('DRAFT', 'APPLIED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."sessionstatusenum" AS ENUM('open', 'paused', 'closed', 'transferred');--> statement-breakpoint
CREATE TYPE "public"."supplierlotstatusenum" AS ENUM('received', 'inspecting', 'approved', 'rejected', 'consumed', 'returned');--> statement-breakpoint
CREATE TYPE "public"."wipstatusenum" AS ENUM('queued', 'in_process', 'waiting', 'completed', 'hold', 'scrapped', 'reworked');--> statement-breakpoint
CREATE TYPE "public"."workorderstatusenum" AS ENUM('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."workordertriggerenum" AS ENUM('MANUAL', 'SCHEDULE', 'PREDICTED_FAILURE', 'HEALTH_SCORE', 'SENSOR_ALERT');--> statement-breakpoint
CREATE TYPE "public"."workordertypeenum" AS ENUM('PREVENTIVE', 'PREDICTIVE', 'CORRECTIVE', 'BREAKDOWN', 'INSPECTION');--> statement-breakpoint
CREATE TABLE "ai_anomaly_memory_bank" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer,
	"machineId" integer,
	"modelCode" varchar(120) NOT NULL,
	"embedding" text NOT NULL,
	"embedding_vec" vector(1024),
	"embeddingDim" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"imageUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_anomaly_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer,
	"machineId" integer,
	"modelCode" varchar(120) NOT NULL,
	"threshold" numeric(12, 8) NOT NULL,
	"k" integer DEFAULT 5 NOT NULL,
	"distStats" json,
	"bankSize" integer DEFAULT 0 NOT NULL,
	"source" varchar(32) NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"builtAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calibration_reports" (
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
CREATE TABLE "ai_pending_actions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"tool" varchar(100) NOT NULL,
	"argsJson" json NOT NULL,
	"userId" integer NOT NULL,
	"userRole" varchar(50) NOT NULL,
	"requiredPermissionJson" json,
	"summary" text NOT NULL,
	"previewJson" json,
	"status" "aipendingactionstatus" DEFAULT 'proposed' NOT NULL,
	"idempotencyKey" varchar(128) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"executedAt" timestamp,
	"resultJson" json,
	CONSTRAINT "ai_pending_actions_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "alert_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"alertId" integer NOT NULL,
	"fromLevel" integer NOT NULL,
	"toLevel" integer NOT NULL,
	"reason" varchar(255) NOT NULL,
	"notifiedUserIds" json DEFAULT '[]'::json,
	"escalatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_segmentations" (
	"id" serial PRIMARY KEY NOT NULL,
	"measurementResultId" integer,
	"inspectionId" integer,
	"imageUrl" text,
	"modelId" integer,
	"modelVersion" varchar(50),
	"source" varchar(16) NOT NULL,
	"maskFormat" varchar(16) DEFAULT 'polygon' NOT NULL,
	"maskData" json NOT NULL,
	"classLabel" varchar(120) NOT NULL,
	"defectCatalogId" integer,
	"confidence" numeric(6, 4),
	"areaPx" numeric(16, 4),
	"perimeterPx" numeric(16, 4),
	"feretMaxPx" numeric(16, 4),
	"feretMinPx" numeric(16, 4),
	"equivDiaPx" numeric(16, 4),
	"umPerPx" numeric(16, 8),
	"areaUnit" varchar(8),
	"lengthUnit" varchar(8),
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dr_restore_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"checkType" varchar(64) DEFAULT 'verify_restore' NOT NULL,
	"status" "drcheckstatusenum" DEFAULT 'running' NOT NULL,
	"rpoSeconds" integer,
	"rtoSeconds" integer,
	"backupRef" varchar(256),
	"details" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"finishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer,
	"layoutId" integer,
	"source" "energysourceenum" DEFAULT 'electricity' NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"unit" varchar(16) DEFAULT 'kWh' NOT NULL,
	"powerKw" numeric(12, 4),
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enpi_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer,
	"layoutId" integer,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"totalKwh" numeric(16, 4) NOT NULL,
	"goodUnits" integer DEFAULT 0 NOT NULL,
	"energyPerUnit" numeric(16, 6),
	"baselineEnergyPerUnit" numeric(16, 6),
	"carbonKg" numeric(16, 4),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_feature_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityType" varchar(64) NOT NULL,
	"entityId" varchar(128) NOT NULL,
	"featureSet" varchar(128) NOT NULL,
	"features" jsonb NOT NULL,
	"computedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_inference_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelName" varchar(128) NOT NULL,
	"modelVersion" varchar(64),
	"entityType" varchar(64),
	"entityId" varchar(128),
	"input" jsonb,
	"output" jsonb,
	"confidence" numeric(6, 4),
	"latencyMs" integer,
	"groundTruth" jsonb,
	"flaggedForReview" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionCode" varchar(64) NOT NULL,
	"shiftConfigId" integer NOT NULL,
	"factoryId" integer NOT NULL,
	"workshopId" integer NOT NULL,
	"lineId" integer,
	"productionOrderId" integer,
	"operatorId" integer NOT NULL,
	"supervisorId" integer,
	"status" "sessionstatusenum" DEFAULT 'open' NOT NULL,
	"shiftDate" timestamp NOT NULL,
	"plannedStart" timestamp NOT NULL,
	"plannedEnd" timestamp NOT NULL,
	"actualStart" timestamp NOT NULL,
	"actualEnd" timestamp,
	"handoverToSessionId" integer,
	"handoverNotes" text,
	"kpiSnapshot" json,
	"operatorNotes" text,
	"supervisorSignoff" boolean DEFAULT false NOT NULL,
	"supervisorSignoffAt" timestamp,
	"signoffPayload" text,
	"signoffPayloadHash" varchar(64),
	"signoffSignature" varchar(128),
	"signoffAlgorithm" varchar(32),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_sessions_sessionCode_unique" UNIQUE("sessionCode")
);
--> statement-breakpoint
CREATE TABLE "machine_sensor_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"sensorType" varchar(50) NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"unit" varchar(20),
	"timestamp" timestamp NOT NULL,
	"source" varchar(50) DEFAULT 'mqtt',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" integer NOT NULL,
	"productionOrderId" integer NOT NULL,
	"lineId" integer NOT NULL,
	"suggestedStart" timestamp NOT NULL,
	"suggestedEnd" timestamp NOT NULL,
	"reason" text,
	"applied" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"factoryId" integer,
	"lineId" integer,
	"algorithm" varchar(20) NOT NULL,
	"status" "schedulerunstatusenum" DEFAULT 'DRAFT' NOT NULL,
	"kpiSummary" json,
	"conflictCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"appliedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "line_balance_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer NOT NULL,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"taktTimeMs" integer,
	"avgCycleTimeMs" integer,
	"maxCycleTimeMs" integer,
	"bottleneckStationId" integer,
	"bottleneckMachineId" integer,
	"utilizationPct" numeric(5, 2),
	"balanceRatePct" numeric(5, 2),
	"throughputUnits" integer DEFAULT 0 NOT NULL,
	"wipCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_disposition" (
	"id" serial PRIMARY KEY NOT NULL,
	"lotNumber" varchar(128) NOT NULL,
	"supplierLotId" integer,
	"serialNumber" varchar(128),
	"disposition" "lotdispositionenum" NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"reason" text,
	"defectCode" varchar(64),
	"decidedBy" integer,
	"decidedAt" timestamp DEFAULT now() NOT NULL,
	"customerReturnRef" varchar(128),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(64),
	"scheduleType" "maintenancescheduletypeenum" DEFAULT 'TIME_BASED' NOT NULL,
	"taskName" varchar(256) NOT NULL,
	"description" text,
	"intervalDays" integer,
	"intervalUsageHours" integer,
	"lastPerformedAt" timestamp,
	"nextDueAt" timestamp,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"workOrderNumber" varchar(64) NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(64),
	"scheduleId" integer,
	"type" "workordertypeenum" DEFAULT 'CORRECTIVE' NOT NULL,
	"status" "workorderstatusenum" DEFAULT 'OPEN' NOT NULL,
	"trigger" "workordertriggerenum" DEFAULT 'MANUAL' NOT NULL,
	"predictedFailureRisk" integer,
	"healthScore" integer,
	"priority" integer DEFAULT 3 NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"assignedTo" integer,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"scheduledFor" timestamp,
	"repairStartedAt" timestamp,
	"closedAt" timestamp,
	"downtimeMinutes" integer,
	"resolutionNotes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_work_orders_workOrderNumber_unique" UNIQUE("workOrderNumber")
);
--> statement-breakpoint
CREATE TABLE "material_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receiptNumber" varchar(64) NOT NULL,
	"supplierName" varchar(256),
	"supplierCode" varchar(64),
	"materialCode" varchar(64) NOT NULL,
	"materialName" varchar(256),
	"quantity" numeric(14, 3) NOT NULL,
	"unit" varchar(16) DEFAULT 'pcs' NOT NULL,
	"receivedDate" timestamp DEFAULT now() NOT NULL,
	"poNumber" varchar(64),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "material_receipts_receiptNumber_unique" UNIQUE("receiptNumber")
);
--> statement-breakpoint
CREATE TABLE "pm_effectiveness_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"machineCode" varchar(64),
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"mttrMinutes" numeric(12, 2),
	"mtbfHours" numeric(12, 2),
	"failureCount" integer DEFAULT 0 NOT NULL,
	"workOrderCount" integer DEFAULT 0 NOT NULL,
	"pmCompliancePct" numeric(5, 2),
	"plannedDowntimeMinutes" integer DEFAULT 0 NOT NULL,
	"unplannedDowntimeMinutes" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_parts_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"partCode" varchar(64) NOT NULL,
	"partName" varchar(256) NOT NULL,
	"category" varchar(64),
	"quantityOnHand" integer DEFAULT 0 NOT NULL,
	"reorderLevel" integer DEFAULT 0 NOT NULL,
	"reorderQuantity" integer DEFAULT 0 NOT NULL,
	"unit" varchar(16) DEFAULT 'pcs' NOT NULL,
	"location" varchar(128),
	"unitCost" numeric(14, 2),
	"supplierCode" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spare_parts_inventory_partCode_unique" UNIQUE("partCode")
);
--> statement-breakpoint
CREATE TABLE "station_dwell_time" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineId" integer,
	"stationId" integer NOT NULL,
	"machineId" integer,
	"serialNumber" varchar(128),
	"lotNumber" varchar(128),
	"dwellMs" integer DEFAULT 0 NOT NULL,
	"processingMs" integer DEFAULT 0 NOT NULL,
	"starvedMs" integer DEFAULT 0 NOT NULL,
	"blockedMs" integer DEFAULT 0 NOT NULL,
	"enteredAt" timestamp DEFAULT now() NOT NULL,
	"exitedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplierLotNumber" varchar(128) NOT NULL,
	"receiptId" integer,
	"materialCode" varchar(64) NOT NULL,
	"materialName" varchar(256),
	"quantity" numeric(14, 3) NOT NULL,
	"remainingQuantity" numeric(14, 3),
	"unit" varchar(16) DEFAULT 'pcs' NOT NULL,
	"status" "supplierlotstatusenum" DEFAULT 'received' NOT NULL,
	"expiryDate" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wip_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"serialNumber" varchar(128),
	"lotNumber" varchar(128),
	"productId" integer,
	"productCode" varchar(64),
	"workOrderNumber" varchar(64),
	"lineId" integer,
	"currentStationId" integer,
	"currentMachineId" integer,
	"status" "wipstatusenum" DEFAULT 'queued' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"enteredAt" timestamp DEFAULT now() NOT NULL,
	"exitedAt" timestamp,
	"parentSerialNumber" varchar(128),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_image_embeddings" ADD COLUMN "embedding_vec" vector(1024);--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "fileHash" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_quality_gate_configs" ADD COLUMN "activeExperimentId" integer;--> statement-breakpoint
ALTER TABLE "edge_deployments" ADD COLUMN "packageVersion" varchar(50);--> statement-breakpoint
ALTER TABLE "edge_deployments" ADD COLUMN "deployedAt" timestamp;--> statement-breakpoint
ALTER TABLE "edge_deployments" ADD COLUMN "activatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "edge_inference_sync" ADD COLUMN "localResultId" varchar(100);--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "fileHash" varchar(128);--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "datasetId" integer;--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "baselineVersionId" integer;--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "evalReport" json;--> statement-breakpoint
ALTER TABLE "predictive_alerts" ADD COLUMN "escalationLevel" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "predictive_alerts" ADD COLUMN "lastEscalatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "training_jobs" ADD COLUMN "datasetId" integer;--> statement-breakpoint
ALTER TABLE "training_jobs" ADD COLUMN "trainingMode" varchar(40) DEFAULT 'local-embedding';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "loginAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lockedUntil" timestamp;--> statement-breakpoint
CREATE INDEX "idx_anomaly_bank_scope" ON "ai_anomaly_memory_bank" USING btree ("productModelId","machineId","modelCode");--> statement-breakpoint
CREATE INDEX "idx_anomaly_bank_product" ON "ai_anomaly_memory_bank" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_anomaly_bank_machine" ON "ai_anomaly_memory_bank" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_anomaly_bank_created" ON "ai_anomaly_memory_bank" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_anomaly_profile_scope" ON "ai_anomaly_profiles" USING btree ("productModelId","machineId","modelCode");--> statement-breakpoint
CREATE INDEX "idx_anomaly_profile_product" ON "ai_anomaly_profiles" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_anomaly_profile_machine" ON "ai_anomaly_profiles" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_ai_calibration_model" ON "ai_calibration_reports" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_ai_calibration_period" ON "ai_calibration_reports" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "idx_ai_calibration_created" ON "ai_calibration_reports" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_ai_pending_actions_user" ON "ai_pending_actions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_ai_pending_actions_status" ON "ai_pending_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_pending_actions_expires" ON "ai_pending_actions" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "idx_alert_esc_alert" ON "alert_escalations" USING btree ("alertId");--> statement-breakpoint
CREATE INDEX "idx_alert_esc_at" ON "alert_escalations" USING btree ("escalatedAt");--> statement-breakpoint
CREATE INDEX "idx_defect_seg_measurement" ON "defect_segmentations" USING btree ("measurementResultId");--> statement-breakpoint
CREATE INDEX "idx_defect_seg_inspection" ON "defect_segmentations" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_defect_seg_model" ON "defect_segmentations" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "idx_defect_seg_source" ON "defect_segmentations" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_defect_seg_created" ON "defect_segmentations" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_drcheck_status" ON "dr_restore_checks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_drcheck_started" ON "dr_restore_checks" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "idx_energy_machine" ON "energy_readings" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_energy_source" ON "energy_readings" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_energy_ts" ON "energy_readings" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_enpi_machine" ON "enpi_metrics" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_enpi_period" ON "enpi_metrics" USING btree ("periodStart");--> statement-breakpoint
CREATE INDEX "idx_mlfeat_entity" ON "ml_feature_cache" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "idx_mlfeat_set" ON "ml_feature_cache" USING btree ("featureSet");--> statement-breakpoint
CREATE INDEX "idx_mlfeat_expires" ON "ml_feature_cache" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "idx_mlaudit_model" ON "ml_inference_audit" USING btree ("modelName");--> statement-breakpoint
CREATE INDEX "idx_mlaudit_entity" ON "ml_inference_audit" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "idx_mlaudit_review" ON "ml_inference_audit" USING btree ("flaggedForReview");--> statement-breakpoint
CREATE INDEX "idx_mlaudit_created" ON "ml_inference_audit" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_ps_shift_config" ON "production_sessions" USING btree ("shiftConfigId");--> statement-breakpoint
CREATE INDEX "idx_ps_factory" ON "production_sessions" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_ps_workshop" ON "production_sessions" USING btree ("workshopId");--> statement-breakpoint
CREATE INDEX "idx_ps_line" ON "production_sessions" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_ps_operator" ON "production_sessions" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_ps_status" ON "production_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ps_shift_date" ON "production_sessions" USING btree ("shiftDate");--> statement-breakpoint
CREATE INDEX "idx_ps_order" ON "production_sessions" USING btree ("productionOrderId");--> statement-breakpoint
CREATE INDEX "idx_sensor_readings_machine_ts" ON "machine_sensor_readings" USING btree ("machineId","timestamp");--> statement-breakpoint
CREATE INDEX "idx_sensor_readings_type" ON "machine_sensor_readings" USING btree ("sensorType");--> statement-breakpoint
CREATE INDEX "idx_schedule_run_items_run" ON "schedule_run_items" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "idx_schedule_run_items_order" ON "schedule_run_items" USING btree ("productionOrderId");--> statement-breakpoint
CREATE INDEX "idx_schedule_run_items_line" ON "schedule_run_items" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_schedule_runs_factory" ON "schedule_runs" USING btree ("factoryId");--> statement-breakpoint
CREATE INDEX "idx_schedule_runs_line" ON "schedule_runs" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_schedule_runs_status" ON "schedule_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_schedule_runs_created" ON "schedule_runs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_linebal_line" ON "line_balance_metrics" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_linebal_period" ON "line_balance_metrics" USING btree ("periodStart");--> statement-breakpoint
CREATE INDEX "idx_lotdisp_lot" ON "lot_disposition" USING btree ("lotNumber");--> statement-breakpoint
CREATE INDEX "idx_lotdisp_suplot" ON "lot_disposition" USING btree ("supplierLotId");--> statement-breakpoint
CREATE INDEX "idx_lotdisp_serial" ON "lot_disposition" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_lotdisp_type" ON "lot_disposition" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "idx_msched_machine" ON "maintenance_schedules" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_msched_due" ON "maintenance_schedules" USING btree ("nextDueAt");--> statement-breakpoint
CREATE INDEX "idx_msched_active" ON "maintenance_schedules" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_wo_machine" ON "maintenance_work_orders" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_wo_status" ON "maintenance_work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wo_type" ON "maintenance_work_orders" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_wo_trigger" ON "maintenance_work_orders" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "idx_wo_opened" ON "maintenance_work_orders" USING btree ("openedAt");--> statement-breakpoint
CREATE INDEX "idx_matrecv_supplier" ON "material_receipts" USING btree ("supplierCode");--> statement-breakpoint
CREATE INDEX "idx_matrecv_material" ON "material_receipts" USING btree ("materialCode");--> statement-breakpoint
CREATE INDEX "idx_matrecv_date" ON "material_receipts" USING btree ("receivedDate");--> statement-breakpoint
CREATE INDEX "idx_pmeff_machine" ON "pm_effectiveness_metrics" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_pmeff_period" ON "pm_effectiveness_metrics" USING btree ("periodStart");--> statement-breakpoint
CREATE INDEX "idx_spare_code" ON "spare_parts_inventory" USING btree ("partCode");--> statement-breakpoint
CREATE INDEX "idx_spare_category" ON "spare_parts_inventory" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_dwell_station" ON "station_dwell_time" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_dwell_line" ON "station_dwell_time" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_dwell_machine" ON "station_dwell_time" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_dwell_entered" ON "station_dwell_time" USING btree ("enteredAt");--> statement-breakpoint
CREATE INDEX "idx_suplot_number" ON "supplier_lots" USING btree ("supplierLotNumber");--> statement-breakpoint
CREATE INDEX "idx_suplot_receipt" ON "supplier_lots" USING btree ("receiptId");--> statement-breakpoint
CREATE INDEX "idx_suplot_material" ON "supplier_lots" USING btree ("materialCode");--> statement-breakpoint
CREATE INDEX "idx_suplot_status" ON "supplier_lots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wip_serial" ON "wip_tracking" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_wip_lot" ON "wip_tracking" USING btree ("lotNumber");--> statement-breakpoint
CREATE INDEX "idx_wip_line" ON "wip_tracking" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_wip_station" ON "wip_tracking" USING btree ("currentStationId");--> statement-breakpoint
CREATE INDEX "idx_wip_status" ON "wip_tracking" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wip_entered" ON "wip_tracking" USING btree ("enteredAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_edge_sync_deployment_localresult" ON "edge_inference_sync" USING btree ("deploymentId","localResultId") WHERE "localResultId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_escalation" ON "predictive_alerts" USING btree ("escalationLevel");