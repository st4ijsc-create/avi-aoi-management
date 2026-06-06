ALTER TYPE "public"."machinetypeenum" ADD VALUE 'SPI' BEFORE 'AUTOMATION';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE 'AXI' BEFORE 'AUTOMATION';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE 'ICT' BEFORE 'AUTOMATION';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE 'FCT' BEFORE 'AUTOMATION';--> statement-breakpoint
ALTER TYPE "public"."machinetypeenum" ADD VALUE 'CMM' BEFORE 'AUTOMATION';--> statement-breakpoint
ALTER TYPE "public"."operationstatusenum" ADD VALUE 'warming_up';--> statement-breakpoint
ALTER TYPE "public"."operationstatusenum" ADD VALUE 'changeover';--> statement-breakpoint
ALTER TYPE "public"."operationstatusenum" ADD VALUE 'starved';--> statement-breakpoint
ALTER TYPE "public"."operationstatusenum" ADD VALUE 'blocked';--> statement-breakpoint
CREATE TABLE "ai_specialist_session_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"stepOrder" integer NOT NULL,
	"agentId" varchar(60) NOT NULL,
	"status" varchar(30) DEFAULT 'completed' NOT NULL,
	"inputPayload" json,
	"outputPayload" json,
	"modelId" varchar(255),
	"tokensPrompt" integer,
	"tokensGenerated" integer,
	"totalTimeMs" integer,
	"tokensPerSecond" numeric(10, 2),
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_specialist_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"sessionType" varchar(30) DEFAULT 'single' NOT NULL,
	"moduleName" varchar(255),
	"objective" text NOT NULL,
	"requestedAgents" json,
	"language" varchar(10) DEFAULT 'vi' NOT NULL,
	"status" varchar(30) DEFAULT 'running' NOT NULL,
	"summary" text,
	"aggregateOutput" json,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporates" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"country" varchar(100),
	"contactEmail" varchar(320),
	"logoUrl" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corporates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cad_import_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobId" integer NOT NULL,
	"candidateIndex" integer NOT NULL,
	"code" varchar(100),
	"name" varchar(255),
	"shape" varchar(20) DEFAULT 'circle' NOT NULL,
	"positionX" numeric(15, 6) NOT NULL,
	"positionY" numeric(15, 6) NOT NULL,
	"positionZ" numeric(15, 6),
	"radius" numeric(15, 6),
	"geometry" jsonb,
	"sourceEntityType" varchar(60),
	"sourceEntityId" varchar(120),
	"selected" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cad_import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"format" varchar(20) NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileKey" varchar(255),
	"fileUrl" text,
	"fileSizeBytes" bigint,
	"fileSha256" varchar(64),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"parserVersion" varchar(40),
	"entityCounts" jsonb,
	"candidatePointCount" integer DEFAULT 0,
	"appliedPointCount" integer DEFAULT 0,
	"errorMessage" text,
	"uploadedBy" integer,
	"appliedBy" integer,
	"appliedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"category" varchar(80) NOT NULL,
	"ipcReference" varchar(50),
	"acceptanceClass" varchar(2),
	"classRules" jsonb,
	"ipcSection" varchar(20),
	"appliesTo" text[],
	"detectableBy" text[],
	"description" text,
	"nameVi" varchar(255),
	"nameZh" varchar(255),
	"descriptionVi" text,
	"descriptionZh" text,
	"referenceImageUrl" text,
	"referenceImageKey" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "fiducial_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(20) DEFAULT 'cross' NOT NULL,
	"positionX" integer NOT NULL,
	"positionY" integer NOT NULL,
	"normalizedX" numeric(10, 8),
	"normalizedY" numeric(10, 8),
	"searchWindowW" integer DEFAULT 80 NOT NULL,
	"searchWindowH" integer DEFAULT 80 NOT NULL,
	"templateImageUrl" text,
	"templateImageKey" varchar(255),
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"deletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genealogy_chain" (
	"id" serial PRIMARY KEY NOT NULL,
	"prevHash" varchar(64) NOT NULL,
	"currHash" varchar(64) NOT NULL,
	"serialNumber" varchar(128) NOT NULL,
	"parentSerial" varchar(128),
	"eventType" varchar(40) NOT NULL,
	"stationCode" varchar(50),
	"lotCode" varchar(80),
	"productModelId" integer,
	"payload" jsonb NOT NULL,
	"recordedBy" integer,
	"recordedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instrument_calibrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrumentId" integer NOT NULL,
	"certNumber" varchar(120) NOT NULL,
	"certPdfUrl" text,
	"certPdfKey" varchar(255),
	"traceability" varchar(80),
	"performedAt" timestamp NOT NULL,
	"validUntil" timestamp NOT NULL,
	"performedBy" varchar(255),
	"performedByOrg" varchar(255),
	"referenceStandard" varchar(255),
	"asFoundBias" numeric(15, 6),
	"asLeftBias" numeric(15, 6),
	"uncertainty" numeric(15, 6),
	"result" varchar(20) DEFAULT 'pass' NOT NULL,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "instrument_msa_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrumentId" integer NOT NULL,
	"msaStudyId" integer,
	"method" varchar(20) DEFAULT 'ARM' NOT NULL,
	"performedAt" timestamp DEFAULT now() NOT NULL,
	"validUntil" timestamp NOT NULL,
	"evPct" numeric(8, 4),
	"avPct" numeric(8, 4),
	"grrPct" numeric(8, 4),
	"ndc" integer,
	"ptRatio" numeric(8, 4),
	"biasValue" numeric(15, 6),
	"linearityScore" numeric(8, 4),
	"stabilityScore" numeric(8, 4),
	"verdict" varchar(20) DEFAULT 'unknown' NOT NULL,
	"approvedBy" integer,
	"approvedAt" timestamp,
	"notes" text,
	"reportPdfUrl" text,
	"reportPdfKey" varchar(255),
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "measurement_instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"instrumentType" varchar(80) NOT NULL,
	"manufacturer" varchar(120),
	"model" varchar(120),
	"serialNumber" varchar(120),
	"defaultUnit" varchar(20),
	"resolution" numeric(15, 6),
	"uncertainty" numeric(15, 6),
	"mmPerPixel" numeric(15, 8),
	"calibrationPeriodDays" integer,
	"lastCalibrationAt" timestamp,
	"nextCalibrationAt" timestamp,
	"msaMethod" varchar(50),
	"notes" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "measurement_point_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointDefId" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshotJson" json NOT NULL,
	"changedBy" integer,
	"changeReason" varchar(500),
	"changedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_samples" (
	"id" bigint NOT NULL,
	"pointDefId" integer NOT NULL,
	"machineId" integer,
	"inspectionId" integer,
	"serialNumber" varchar(128),
	"stationCode" varchar(50),
	"value" numeric(15, 6) NOT NULL,
	"isOk" boolean,
	"operatorId" integer,
	"instrumentId" integer,
	"lotCode" varchar(80),
	"shiftCode" varchar(20),
	"envTempC" numeric(6, 2),
	"envRhPct" numeric(5, 2),
	"sampledAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_type_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" varchar(50) NOT NULL,
	"subType" varchar(80) NOT NULL,
	"code" varchar(100) NOT NULL,
	"nameEn" varchar(200),
	"nameVi" varchar(200),
	"defaultUnit" varchar(20),
	"valueKind" varchar(20),
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "mp_lighting_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointDefId" integer NOT NULL,
	"shotIndex" integer DEFAULT 1 NOT NULL,
	"name" varchar(120),
	"lightSource" varchar(40) DEFAULT 'ring' NOT NULL,
	"color" varchar(20) DEFAULT 'white' NOT NULL,
	"colorHex" varchar(7),
	"intensityPct" integer DEFAULT 100 NOT NULL,
	"angleDeg" integer,
	"exposureUs" integer,
	"gain" numeric(8, 3),
	"focusOffsetUm" integer,
	"opticalFilter" varchar(60),
	"purpose" varchar(60),
	"referenceImageUrl" text,
	"referenceImageKey" varchar(255),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "mp_spc_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointDefId" integer NOT NULL,
	"machineId" integer,
	"ruleCode" varchar(40) NOT NULL,
	"ruleName" varchar(120) NOT NULL,
	"severity" varchar(20) DEFAULT 'warn' NOT NULL,
	"windowFrom" timestamp NOT NULL,
	"windowTo" timestamp NOT NULL,
	"sampleIds" bigint[],
	"summary" jsonb,
	"ackBy" integer,
	"ackAt" timestamp,
	"ackNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mp_spc_rolling" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointDefId" integer NOT NULL,
	"windowSize" integer DEFAULT 30 NOT NULL,
	"n" integer NOT NULL,
	"mean" numeric(18, 6),
	"stdDev" numeric(18, 6),
	"minValue" numeric(18, 6),
	"maxValue" numeric(18, 6),
	"cp" numeric(10, 4),
	"cpk" numeric(10, 4),
	"pp" numeric(10, 4),
	"ppk" numeric(10, 4),
	"ewmaLast" numeric(18, 6),
	"computedAt" timestamp DEFAULT now() NOT NULL,
	"validUntil" timestamp
);
--> statement-breakpoint
CREATE TABLE "msa_csv_mapping_presets" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "msa_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"studyId" integer NOT NULL,
	"operatorName" varchar(120) NOT NULL,
	"partLabel" varchar(120) NOT NULL,
	"trialNo" integer NOT NULL,
	"measuredValue" numeric(15, 6) NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "msa_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"measurementPointDefId" integer,
	"instrumentId" integer,
	"studyCode" varchar(60) NOT NULL,
	"name" varchar(255) NOT NULL,
	"studyType" varchar(30) DEFAULT 'gage_rr' NOT NULL,
	"operatorCount" integer DEFAULT 3 NOT NULL,
	"partCount" integer DEFAULT 10 NOT NULL,
	"trialCount" integer DEFAULT 2 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"summary" jsonb,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "product_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"viewType" varchar(30) DEFAULT 'top' NOT NULL,
	"referenceImageUrl" text,
	"referenceImageKey" varchar(255),
	"transform" jsonb,
	"orderIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "sampling_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(255) NOT NULL,
	"strategy" varchar(30) DEFAULT 'fixed_n' NOT NULL,
	"lotSize" integer,
	"aqlCritical" numeric(6, 3),
	"aqlMajor" numeric(6, 3),
	"aqlMinor" numeric(6, 3),
	"sampleSize" integer,
	"acceptanceQty" integer,
	"rejectionQty" integer,
	"rules" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "station_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"serialNumber" varchar(128) NOT NULL,
	"productModelId" integer,
	"lotCode" varchar(80),
	"firstSeenAt" timestamp,
	"lastSeenAt" timestamp,
	"stationsTouched" text[],
	"firstDefectStation" varchar(50),
	"firstEscapeStation" varchar(50),
	"totalDefects" integer DEFAULT 0 NOT NULL,
	"totalEscapes" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threshold_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"pointDefId" integer NOT NULL,
	"requestedBy" integer NOT NULL,
	"suggestion" jsonb NOT NULL,
	"currentLsl" numeric(18, 6),
	"currentUsl" numeric(18, 6),
	"currentNominal" numeric(18, 6),
	"proposedLsl" numeric(18, 6) NOT NULL,
	"proposedUsl" numeric(18, 6) NOT NULL,
	"proposedNominal" numeric(18, 6),
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"comment" text,
	"decidedBy" integer,
	"decidedAt" timestamp,
	"decidedComment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_user_corporate_unique";--> statement-breakpoint
ALTER TABLE "factories" ADD COLUMN "corporateCode" varchar(50);--> statement-breakpoint
ALTER TABLE "factories" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Ho_Chi_Minh';--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "preferredInstrumentId" integer;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "preferredSamplingPlanId" integer;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "shape" varchar(20) DEFAULT 'circle' NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "geometry" json;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "positionZ" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "heightMin" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "heightMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "heightNominal" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "heightUnit" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "areaMin" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "areaMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "areaNominal" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "areaUnit" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "volumeMin" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "volumeMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "volumeNominal" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "volumeUnit" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "coplanarityMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "warpageMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "voidPctMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "offsetXMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "offsetYMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "tiltMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "thicknessMin" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "thicknessMax" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "depthMapUrl" text;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "pointCloudUrl" text;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "measurementTypeCode" varchar(100);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "toleranceMode" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "tolPlus" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "tolMinus" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "criteria" jsonb;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "extraFields" jsonb;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "datumRefs" text[];--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "materialCondition" varchar(10);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "fitClass" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "productViewId" integer;--> statement-breakpoint
ALTER TABLE "measurement_point_defs" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "product_models" ADD COLUMN "coordinateMode" varchar(20) DEFAULT 'pixel' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_models" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueZ" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueHeight" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueArea" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueVolume" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueVoidPct" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueCoplanarity" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueWarpage" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueOffsetX" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueOffsetY" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueTilt" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "valueThickness" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectCatalogId" integer;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectSeverity" varchar(20);--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectBboxX" integer;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectBboxY" integer;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectBboxW" integer;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectBboxH" integer;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectCropUrl" text;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "defectCropKey" varchar(255);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "inspectionType" varchar(40);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "variantPayload" jsonb;--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_steps_session" ON "ai_specialist_session_steps" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_steps_agent" ON "ai_specialist_session_steps" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_steps_status" ON "ai_specialist_session_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_steps_created" ON "ai_specialist_session_steps" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_sessions_user" ON "ai_specialist_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_sessions_module" ON "ai_specialist_sessions" USING btree ("moduleName");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_sessions_status" ON "ai_specialist_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_specialist_sessions_created" ON "ai_specialist_sessions" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_corporates_code" ON "corporates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_corporates_active" ON "corporates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_cad_import_candidates_job" ON "cad_import_candidates" USING btree ("jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cad_import_candidates_job_idx" ON "cad_import_candidates" USING btree ("jobId","candidateIndex");--> statement-breakpoint
CREATE INDEX "idx_cad_import_jobs_product" ON "cad_import_jobs" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_cad_import_jobs_status" ON "cad_import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cad_import_jobs_created" ON "cad_import_jobs" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_defect_catalog_code" ON "defect_catalog" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_defect_catalog_severity" ON "defect_catalog" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_defect_catalog_category" ON "defect_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_defect_catalog_active" ON "defect_catalog" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_defect_catalog_deleted_at" ON "defect_catalog" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_defect_catalog_ipc_section" ON "defect_catalog" USING btree ("ipcSection");--> statement-breakpoint
CREATE INDEX "idx_fiducial_marks_product" ON "fiducial_marks" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_fiducial_marks_code" ON "fiducial_marks" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_fiducial_marks_deleted_at" ON "fiducial_marks" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "uq_fiducial_marks_product_code" ON "fiducial_marks" USING btree ("productModelId","code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_genealogy_chain_curr_hash" ON "genealogy_chain" USING btree ("currHash");--> statement-breakpoint
CREATE INDEX "idx_genealogy_chain_serial" ON "genealogy_chain" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_genealogy_chain_parent" ON "genealogy_chain" USING btree ("parentSerial");--> statement-breakpoint
CREATE INDEX "idx_genealogy_chain_lot" ON "genealogy_chain" USING btree ("lotCode");--> statement-breakpoint
CREATE INDEX "idx_genealogy_chain_recorded" ON "genealogy_chain" USING btree ("recordedAt");--> statement-breakpoint
CREATE INDEX "idx_instr_cal_instrument" ON "instrument_calibrations" USING btree ("instrumentId");--> statement-breakpoint
CREATE INDEX "idx_instr_cal_valid_until" ON "instrument_calibrations" USING btree ("validUntil");--> statement-breakpoint
CREATE INDEX "idx_instr_cal_performed_at" ON "instrument_calibrations" USING btree ("performedAt");--> statement-breakpoint
CREATE INDEX "idx_instr_cal_deleted_at" ON "instrument_calibrations" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_instr_msa_instrument" ON "instrument_msa_records" USING btree ("instrumentId");--> statement-breakpoint
CREATE INDEX "idx_instr_msa_valid_until" ON "instrument_msa_records" USING btree ("validUntil");--> statement-breakpoint
CREATE INDEX "idx_instr_msa_study" ON "instrument_msa_records" USING btree ("msaStudyId");--> statement-breakpoint
CREATE INDEX "idx_instr_msa_deleted_at" ON "instrument_msa_records" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_measurement_instruments_code" ON "measurement_instruments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_measurement_instruments_type" ON "measurement_instruments" USING btree ("instrumentType");--> statement-breakpoint
CREATE INDEX "idx_measurement_instruments_active" ON "measurement_instruments" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_measurement_instruments_deleted_at" ON "measurement_instruments" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_point_versions_point" ON "measurement_point_versions" USING btree ("pointDefId");--> statement-breakpoint
CREATE INDEX "idx_point_versions_changed_at" ON "measurement_point_versions" USING btree ("changedAt");--> statement-breakpoint
CREATE INDEX "uq_point_versions_point_version" ON "measurement_point_versions" USING btree ("pointDefId","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_meas_type_catalog_code" ON "measurement_type_catalog" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_meas_type_catalog_category" ON "measurement_type_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_meas_type_catalog_active" ON "measurement_type_catalog" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_meas_type_catalog_deleted_at" ON "measurement_type_catalog" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_mp_lighting_point" ON "mp_lighting_profiles" USING btree ("pointDefId");--> statement-breakpoint
CREATE INDEX "idx_mp_lighting_active" ON "mp_lighting_profiles" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_mp_lighting_deleted_at" ON "mp_lighting_profiles" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_mp_spc_alerts_point" ON "mp_spc_alerts" USING btree ("pointDefId");--> statement-breakpoint
CREATE INDEX "idx_mp_spc_alerts_rule" ON "mp_spc_alerts" USING btree ("ruleCode");--> statement-breakpoint
CREATE INDEX "idx_mp_spc_alerts_window" ON "mp_spc_alerts" USING btree ("windowFrom","windowTo");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mp_spc_rolling_point_window" ON "mp_spc_rolling" USING btree ("pointDefId","windowSize");--> statement-breakpoint
CREATE INDEX "idx_mp_spc_rolling_computed" ON "mp_spc_rolling" USING btree ("computedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_msa_csv_mapping_presets_scope" ON "msa_csv_mapping_presets" USING btree ("productModelId","sourceMachine","presetName");--> statement-breakpoint
CREATE INDEX "idx_msa_csv_mapping_presets_product" ON "msa_csv_mapping_presets" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_msa_csv_mapping_presets_source" ON "msa_csv_mapping_presets" USING btree ("sourceMachine");--> statement-breakpoint
CREATE INDEX "idx_msa_csv_mapping_presets_deleted_at" ON "msa_csv_mapping_presets" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_msa_observations_matrix_cell" ON "msa_observations" USING btree ("studyId","operatorName","partLabel","trialNo");--> statement-breakpoint
CREATE INDEX "idx_msa_observations_study" ON "msa_observations" USING btree ("studyId");--> statement-breakpoint
CREATE INDEX "idx_msa_observations_operator" ON "msa_observations" USING btree ("operatorName");--> statement-breakpoint
CREATE INDEX "idx_msa_observations_part" ON "msa_observations" USING btree ("partLabel");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_msa_studies_product_code" ON "msa_studies" USING btree ("productModelId","studyCode");--> statement-breakpoint
CREATE INDEX "idx_msa_studies_product" ON "msa_studies" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_msa_studies_status" ON "msa_studies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_msa_studies_deleted_at" ON "msa_studies" USING btree ("deletedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product_views_product_code" ON "product_views" USING btree ("productModelId","code");--> statement-breakpoint
CREATE INDEX "idx_product_views_product" ON "product_views" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_product_views_order" ON "product_views" USING btree ("productModelId","orderIndex");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sampling_plans_product_code" ON "sampling_plans" USING btree ("productModelId","code");--> statement-breakpoint
CREATE INDEX "idx_sampling_plans_product" ON "sampling_plans" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_sampling_plans_active" ON "sampling_plans" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_station_traces_serial" ON "station_traces" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_station_traces_product" ON "station_traces" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_station_traces_lot" ON "station_traces" USING btree ("lotCode");--> statement-breakpoint
CREATE INDEX "idx_station_traces_first_escape" ON "station_traces" USING btree ("firstEscapeStation");--> statement-breakpoint
CREATE INDEX "idx_station_traces_updated" ON "station_traces" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX "idx_threshold_approvals_pointdef" ON "threshold_approvals" USING btree ("pointDefId");--> statement-breakpoint
CREATE INDEX "idx_threshold_approvals_status" ON "threshold_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_threshold_approvals_requestedby" ON "threshold_approvals" USING btree ("requestedBy");--> statement-breakpoint
CREATE INDEX "idx_factories_corporate" ON "factories" USING btree ("corporateCode");--> statement-breakpoint
CREATE INDEX "idx_point_defs_deleted_at" ON "measurement_point_defs" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_point_defs_type_code" ON "measurement_point_defs" USING btree ("measurementTypeCode");--> statement-breakpoint
CREATE INDEX "idx_product_models_deleted_at" ON "product_models" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "idx_inspections_type" ON "product_inspections" USING btree ("inspectionType");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_corporate_unique" ON "user_corporate_assignments" USING btree ("userId","corporateCode");