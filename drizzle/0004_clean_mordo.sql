CREATE TYPE "public"."webhook_event_type" AS ENUM('inspection.created', 'inspection.updated', 'alert.triggered', 'machine.status_changed', 'machine.offline', 'production_order.created', 'production_order.completed', 'yield.threshold_exceeded', 'backup.completed', 'system.error');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_action_enum" AS ENUM('alert', 'pause', 'stop');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_event_status_enum" AS ENUM('active', 'acknowledged', 'resolved', 'auto_resolved');--> statement-breakpoint
CREATE TYPE "public"."quality_gate_type_enum" AS ENUM('yield_rate', 'ng_count', 'ng_rate', 'cpk_threshold', 'consecutive_ng');--> statement-breakpoint
CREATE TYPE "public"."spc_chart_type_enum" AS ENUM('xbar_r', 'xbar_s', 'individual_mr', 'p_chart', 'np_chart', 'c_chart', 'u_chart');--> statement-breakpoint
CREATE TYPE "public"."spc_rule_type_enum" AS ENUM('western_electric_1', 'western_electric_2', 'western_electric_3', 'western_electric_4', 'nelson_1', 'nelson_2', 'nelson_3', 'nelson_4', 'nelson_5', 'nelson_6', 'nelson_7', 'nelson_8');--> statement-breakpoint
CREATE TYPE "public"."spc_severity_enum" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."license_status_enum" AS ENUM('active', 'expired', 'revoked', 'suspended', 'pending');--> statement-breakpoint
CREATE TYPE "public"."license_type_enum" AS ENUM('trial', 'standard', 'professional', 'enterprise', 'lifetime');--> statement-breakpoint
ALTER TYPE "public"."permissioncategoryenum" ADD VALUE 'production';--> statement-breakpoint
ALTER TYPE "public"."permissioncategoryenum" ADD VALUE 'machine_monitoring';--> statement-breakpoint
ALTER TYPE "public"."permissioncategoryenum" ADD VALUE 'annotations';--> statement-breakpoint
CREATE TABLE "user_custom_dashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"widgets" json DEFAULT '[]'::json NOT NULL,
	"gridCols" integer DEFAULT 4 NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"isFavorite" boolean DEFAULT false NOT NULL,
	"autoRefreshInterval" integer DEFAULT 0 NOT NULL,
	"globalFilters" json DEFAULT '{}'::json,
	"themePreset" varchar(50) DEFAULT 'default',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_bulletin_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"bulletinType" varchar(20) DEFAULT 'PERIODIC' NOT NULL,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"totalCount" integer DEFAULT 0 NOT NULL,
	"okCount" integer DEFAULT 0 NOT NULL,
	"ngCount" integer DEFAULT 0 NOT NULL,
	"ntfCount" integer DEFAULT 0 NOT NULL,
	"yieldRate" numeric(5, 2),
	"failPoints" json,
	"payload" json NOT NULL,
	"deliveryStatus" "deliverystatusenum" DEFAULT 'PENDING' NOT NULL,
	"deliveredAt" timestamp,
	"sentViaLocal" boolean DEFAULT false NOT NULL,
	"sentViaExternal" boolean DEFAULT false NOT NULL,
	"sentViaFcm" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_bulletin_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"stationId" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"intervalMinutes" integer DEFAULT 60 NOT NULL,
	"scheduleType" varchar(20) DEFAULT 'interval' NOT NULL,
	"cronExpression" varchar(100),
	"startHour" integer DEFAULT 6 NOT NULL,
	"endHour" integer DEFAULT 22 NOT NULL,
	"includeImages" boolean DEFAULT true NOT NULL,
	"maxFailPoints" integer DEFAULT 20 NOT NULL,
	"sendToExternal" boolean DEFAULT true NOT NULL,
	"sendFcm" boolean DEFAULT true NOT NULL,
	"lastSentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"secret" varchar(255),
	"events" json NOT NULL,
	"headers" json,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"retryCount" integer DEFAULT 3 NOT NULL,
	"retryDelayMs" integer DEFAULT 5000 NOT NULL,
	"timeoutMs" integer DEFAULT 10000 NOT NULL,
	"createdBy" integer NOT NULL,
	"lastTriggeredAt" timestamp,
	"successCount" integer DEFAULT 0 NOT NULL,
	"failureCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhookId" integer NOT NULL,
	"eventType" varchar(100) NOT NULL,
	"payload" json NOT NULL,
	"responseStatus" integer,
	"responseBody" text,
	"responseTimeMs" integer,
	"success" boolean DEFAULT false NOT NULL,
	"errorMessage" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correlation_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"productModelId" integer,
	"workstationId" integer,
	"machineId" integer,
	"pointIds" json NOT NULL,
	"correlationMatrix" json NOT NULL,
	"sampleSize" integer NOT NULL,
	"analysisDate" timestamp NOT NULL,
	"significanceLevel" numeric(5, 4) DEFAULT '0.05',
	"strongCorrelations" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cpk_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"measurementPointDefId" integer NOT NULL,
	"workstationId" integer,
	"productModelId" integer,
	"machineId" integer,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"sampleSize" integer NOT NULL,
	"mean" numeric(15, 6) NOT NULL,
	"stdDev" numeric(15, 6) NOT NULL,
	"cp" numeric(10, 4),
	"cpk" numeric(10, 4),
	"pp" numeric(10, 4),
	"ppk" numeric(10, 4),
	"cpl" numeric(10, 4),
	"cpu" numeric(10, 4),
	"usl" numeric(15, 6),
	"lsl" numeric(15, 6),
	"nominal" numeric(15, 6),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"qualityGateId" integer NOT NULL,
	"triggeredAt" timestamp DEFAULT now() NOT NULL,
	"triggerValue" numeric(10, 4) NOT NULL,
	"threshold" numeric(10, 4) NOT NULL,
	"action" "quality_gate_action_enum" NOT NULL,
	"status" "quality_gate_event_status_enum" DEFAULT 'active' NOT NULL,
	"machineId" integer,
	"productionOrderId" integer,
	"affectedCount" integer DEFAULT 0,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"autoResolved" boolean DEFAULT false,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"lineId" integer,
	"workstationId" integer,
	"productModelId" integer,
	"machineId" integer,
	"gateType" "quality_gate_type_enum" NOT NULL,
	"threshold" numeric(10, 4) NOT NULL,
	"comparisonOperator" "comparisonoperatorenum" DEFAULT 'lt' NOT NULL,
	"windowSize" integer DEFAULT 100,
	"consecutiveCount" integer DEFAULT 3,
	"action" "quality_gate_action_enum" DEFAULT 'alert' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"autoResumeAfterMinutes" integer,
	"notifyRoles" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spc_configurations" (
	"id" serial PRIMARY KEY NOT NULL,
	"measurementPointDefId" integer,
	"workstationId" integer,
	"productModelId" integer,
	"machineId" integer,
	"chartType" "spc_chart_type_enum" DEFAULT 'xbar_r' NOT NULL,
	"subgroupSize" integer DEFAULT 5 NOT NULL,
	"controlLimitMethod" varchar(20) DEFAULT 'auto' NOT NULL,
	"manualUCL" numeric(15, 6),
	"manualLCL" numeric(15, 6),
	"manualCenterLine" numeric(15, 6),
	"movingRangeSpan" integer DEFAULT 2,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spc_rule_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"measurementPointDefId" integer,
	"workstationId" integer,
	"machineId" integer,
	"productModelId" integer,
	"ruleType" "spc_rule_type_enum" NOT NULL,
	"ruleName" varchar(255) NOT NULL,
	"ruleDescription" text,
	"severity" "spc_severity_enum" DEFAULT 'warning' NOT NULL,
	"violatingValues" json,
	"subgroupIndices" json,
	"controlLimits" json,
	"detectedAt" timestamp DEFAULT now() NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"resolvedBy" integer,
	"resolvedAt" timestamp,
	"resolutionNotes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" integer NOT NULL,
	"license_key" varchar(50) NOT NULL,
	"machine_name" varchar(255),
	"hardware_fingerprint" varchar(128),
	"ip_address" varchar(45),
	"client_version" varchar(50),
	"os_info" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"deactivated_at" timestamp,
	"offline_token" text
);
--> statement-breakpoint
CREATE TABLE "license_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_code" varchar(50) NOT NULL,
	"module_name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "license_modules_module_code_unique" UNIQUE("module_code")
);
--> statement-breakpoint
CREATE TABLE "license_revocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_key" varchar(50) NOT NULL,
	"reason" text,
	"revoked_by" varchar(255),
	"revoked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "license_revocations_license_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint
CREATE TABLE "license_sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_id" integer NOT NULL,
	"license_key" varchar(50) NOT NULL,
	"hardware_fingerprint" varchar(128),
	"sync_type" varchar(20) DEFAULT 'heartbeat' NOT NULL,
	"sync_result" varchar(20) DEFAULT 'success' NOT NULL,
	"client_version" varchar(50),
	"ip_address" varchar(45),
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_key" varchar(50) NOT NULL,
	"product_code" varchar(50) NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"customer_email" varchar(255),
	"company_name" varchar(255),
	"status" "license_status_enum" DEFAULT 'active' NOT NULL,
	"license_type" "license_type_enum" DEFAULT 'standard' NOT NULL,
	"allowed_modules" json DEFAULT '[]'::json NOT NULL,
	"max_users" integer,
	"max_machines" integer,
	"max_activations" integer DEFAULT 1 NOT NULL,
	"current_activations" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"last_activated_at" timestamp,
	"max_offline_days" integer DEFAULT 30 NOT NULL,
	"grace_period_days" integer DEFAULT 7 NOT NULL,
	"require_hardware_binding" boolean DEFAULT true NOT NULL,
	"notes" text,
	"custom_data" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_license_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_sync_logs" ADD CONSTRAINT "license_sync_logs_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_custom_dashboards_user" ON "user_custom_dashboards" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_user_custom_dashboards_public" ON "user_custom_dashboards" USING btree ("isPublic");--> statement-breakpoint
CREATE INDEX "idx_user_custom_dashboards_favorite" ON "user_custom_dashboards" USING btree ("userId","isFavorite");--> statement-breakpoint
CREATE INDEX "idx_bulletin_history_station" ON "mqtt_bulletin_history" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_bulletin_history_period" ON "mqtt_bulletin_history" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "idx_bulletin_history_created" ON "mqtt_bulletin_history" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_bulletin_history_status" ON "mqtt_bulletin_history" USING btree ("deliveryStatus");--> statement-breakpoint
CREATE INDEX "idx_bulletin_settings_station" ON "mqtt_bulletin_settings" USING btree ("stationId");--> statement-breakpoint
CREATE INDEX "idx_bulletin_settings_enabled" ON "mqtt_bulletin_settings" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_webhook_configs_enabled" ON "webhook_configs" USING btree ("isEnabled");--> statement-breakpoint
CREATE INDEX "idx_webhook_configs_created_by" ON "webhook_configs" USING btree ("createdBy");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_webhook" ON "webhook_delivery_logs" USING btree ("webhookId");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_event" ON "webhook_delivery_logs" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_success" ON "webhook_delivery_logs" USING btree ("success");--> statement-breakpoint
CREATE INDEX "idx_webhook_delivery_created" ON "webhook_delivery_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_correlation_product" ON "correlation_analyses" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_correlation_workstation" ON "correlation_analyses" USING btree ("workstationId");--> statement-breakpoint
CREATE INDEX "idx_correlation_date" ON "correlation_analyses" USING btree ("analysisDate");--> statement-breakpoint
CREATE INDEX "idx_cpk_history_point" ON "cpk_history" USING btree ("measurementPointDefId");--> statement-breakpoint
CREATE INDEX "idx_cpk_history_workstation" ON "cpk_history" USING btree ("workstationId");--> statement-breakpoint
CREATE INDEX "idx_cpk_history_product" ON "cpk_history" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_cpk_history_period" ON "cpk_history" USING btree ("periodStart","periodEnd");--> statement-breakpoint
CREATE INDEX "idx_cpk_history_cpk" ON "cpk_history" USING btree ("cpk");--> statement-breakpoint
CREATE INDEX "idx_qg_event_gate" ON "quality_gate_events" USING btree ("qualityGateId");--> statement-breakpoint
CREATE INDEX "idx_qg_event_status" ON "quality_gate_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_qg_event_triggered" ON "quality_gate_events" USING btree ("triggeredAt");--> statement-breakpoint
CREATE INDEX "idx_qg_event_machine" ON "quality_gate_events" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_quality_gate_line" ON "quality_gates" USING btree ("lineId");--> statement-breakpoint
CREATE INDEX "idx_quality_gate_workstation" ON "quality_gates" USING btree ("workstationId");--> statement-breakpoint
CREATE INDEX "idx_quality_gate_product" ON "quality_gates" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_quality_gate_active" ON "quality_gates" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_quality_gate_type" ON "quality_gates" USING btree ("gateType");--> statement-breakpoint
CREATE INDEX "idx_spc_config_point" ON "spc_configurations" USING btree ("measurementPointDefId");--> statement-breakpoint
CREATE INDEX "idx_spc_config_workstation" ON "spc_configurations" USING btree ("workstationId");--> statement-breakpoint
CREATE INDEX "idx_spc_config_product" ON "spc_configurations" USING btree ("productModelId");--> statement-breakpoint
CREATE INDEX "idx_spc_config_active" ON "spc_configurations" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_point" ON "spc_rule_violations" USING btree ("measurementPointDefId");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_workstation" ON "spc_rule_violations" USING btree ("workstationId");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_rule" ON "spc_rule_violations" USING btree ("ruleType");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_severity" ON "spc_rule_violations" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_active" ON "spc_rule_violations" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_spc_violations_detected" ON "spc_rule_violations" USING btree ("detectedAt");--> statement-breakpoint
CREATE INDEX "idx_activations_license" ON "license_activations" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "idx_activations_key" ON "license_activations" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "idx_activations_fingerprint" ON "license_activations" USING btree ("hardware_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_activations_key_fingerprint" ON "license_activations" USING btree ("license_key","hardware_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_modules_code" ON "license_modules" USING btree ("module_code");--> statement-breakpoint
CREATE INDEX "idx_revocations_key" ON "license_revocations" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_license" ON "license_sync_logs" USING btree ("license_id");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_key" ON "license_sync_logs" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "idx_sync_logs_created" ON "license_sync_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_licenses_key" ON "licenses" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX "idx_licenses_status" ON "licenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_licenses_product" ON "licenses" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX "idx_licenses_customer_email" ON "licenses" USING btree ("customer_email");