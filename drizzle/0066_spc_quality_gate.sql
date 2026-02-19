-- Migration 0066: SPC Advanced Features & Quality Gate Integration
-- Features: Workstation-level SPC, Correlation Analysis, SPC Rule Violations,
--           CPK Trend Over Time, Quality Gate Integration

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════════════════════════

-- SPC chart type
CREATE TYPE "spc_chart_type_enum" AS ENUM (
  'xbar_r', 'xbar_s', 'individual_mr', 'p_chart', 'np_chart', 'c_chart', 'u_chart'
);

-- SPC rule type (Western Electric + Nelson)
CREATE TYPE "spc_rule_type_enum" AS ENUM (
  'western_electric_1', 'western_electric_2', 'western_electric_3', 'western_electric_4',
  'nelson_1', 'nelson_2', 'nelson_3', 'nelson_4',
  'nelson_5', 'nelson_6', 'nelson_7', 'nelson_8'
);

-- SPC rule severity
CREATE TYPE "spc_severity_enum" AS ENUM ('info', 'warning', 'critical');

-- Quality gate type  
CREATE TYPE "quality_gate_type_enum" AS ENUM (
  'yield_rate', 'ng_count', 'ng_rate', 'cpk_threshold', 'consecutive_ng'
);

-- Quality gate action
CREATE TYPE "quality_gate_action_enum" AS ENUM ('alert', 'pause', 'stop');

-- Quality gate event status
CREATE TYPE "quality_gate_event_status_enum" AS ENUM (
  'active', 'acknowledged', 'resolved', 'auto_resolved'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. SPC CONFIGURATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "spc_configurations" (
  "id" serial PRIMARY KEY,
  "measurementPointDefId" integer,
  "workstationId" integer,
  "productModelId" integer,
  "machineId" integer,
  "chartType" "spc_chart_type_enum" DEFAULT 'xbar_r' NOT NULL,
  "subgroupSize" integer DEFAULT 5 NOT NULL,
  "controlLimitMethod" varchar(20) DEFAULT 'auto' NOT NULL,
  "manualUCL" decimal(15, 6),
  "manualLCL" decimal(15, 6),
  "manualCenterLine" decimal(15, 6),
  "movingRangeSpan" integer DEFAULT 2,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_spc_config_point" ON "spc_configurations" ("measurementPointDefId");
CREATE INDEX "idx_spc_config_workstation" ON "spc_configurations" ("workstationId");
CREATE INDEX "idx_spc_config_product" ON "spc_configurations" ("productModelId");
CREATE INDEX "idx_spc_config_active" ON "spc_configurations" ("isActive");

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. SPC RULE VIOLATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "spc_rule_violations" (
  "id" serial PRIMARY KEY,
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

CREATE INDEX "idx_spc_violations_point" ON "spc_rule_violations" ("measurementPointDefId");
CREATE INDEX "idx_spc_violations_workstation" ON "spc_rule_violations" ("workstationId");
CREATE INDEX "idx_spc_violations_rule" ON "spc_rule_violations" ("ruleType");
CREATE INDEX "idx_spc_violations_severity" ON "spc_rule_violations" ("severity");
CREATE INDEX "idx_spc_violations_active" ON "spc_rule_violations" ("isActive");
CREATE INDEX "idx_spc_violations_detected" ON "spc_rule_violations" ("detectedAt");

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. CPK HISTORY
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "cpk_history" (
  "id" serial PRIMARY KEY,
  "measurementPointDefId" integer NOT NULL,
  "workstationId" integer,
  "productModelId" integer,
  "machineId" integer,
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "sampleSize" integer NOT NULL,
  "mean" decimal(15, 6) NOT NULL,
  "stdDev" decimal(15, 6) NOT NULL,
  "cp" decimal(10, 4),
  "cpk" decimal(10, 4),
  "pp" decimal(10, 4),
  "ppk" decimal(10, 4),
  "cpl" decimal(10, 4),
  "cpu" decimal(10, 4),
  "usl" decimal(15, 6),
  "lsl" decimal(15, 6),
  "nominal" decimal(15, 6),
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_cpk_history_point" ON "cpk_history" ("measurementPointDefId");
CREATE INDEX "idx_cpk_history_workstation" ON "cpk_history" ("workstationId");
CREATE INDEX "idx_cpk_history_product" ON "cpk_history" ("productModelId");
CREATE INDEX "idx_cpk_history_period" ON "cpk_history" ("periodStart", "periodEnd");
CREATE INDEX "idx_cpk_history_cpk" ON "cpk_history" ("cpk");

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CORRELATION ANALYSES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "correlation_analyses" (
  "id" serial PRIMARY KEY,
  "productModelId" integer,
  "workstationId" integer,
  "machineId" integer,
  "pointIds" json NOT NULL,
  "correlationMatrix" json NOT NULL,
  "sampleSize" integer NOT NULL,
  "analysisDate" timestamp NOT NULL,
  "significanceLevel" decimal(5, 4) DEFAULT 0.05,
  "strongCorrelations" json,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_correlation_product" ON "correlation_analyses" ("productModelId");
CREATE INDEX "idx_correlation_workstation" ON "correlation_analyses" ("workstationId");
CREATE INDEX "idx_correlation_date" ON "correlation_analyses" ("analysisDate");

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. QUALITY GATES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "quality_gates" (
  "id" serial PRIMARY KEY,
  "name" varchar(255) NOT NULL,
  "description" text,
  "lineId" integer,
  "workstationId" integer,
  "productModelId" integer,
  "machineId" integer,
  "gateType" "quality_gate_type_enum" NOT NULL,
  "threshold" decimal(10, 4) NOT NULL,
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

CREATE INDEX "idx_quality_gate_line" ON "quality_gates" ("lineId");
CREATE INDEX "idx_quality_gate_workstation" ON "quality_gates" ("workstationId");
CREATE INDEX "idx_quality_gate_product" ON "quality_gates" ("productModelId");
CREATE INDEX "idx_quality_gate_active" ON "quality_gates" ("isActive");
CREATE INDEX "idx_quality_gate_type" ON "quality_gates" ("gateType");

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. QUALITY GATE EVENTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE "quality_gate_events" (
  "id" serial PRIMARY KEY,
  "qualityGateId" integer NOT NULL,
  "triggeredAt" timestamp DEFAULT now() NOT NULL,
  "triggerValue" decimal(10, 4) NOT NULL,
  "threshold" decimal(10, 4) NOT NULL,
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

CREATE INDEX "idx_qg_event_gate" ON "quality_gate_events" ("qualityGateId");
CREATE INDEX "idx_qg_event_status" ON "quality_gate_events" ("status");
CREATE INDEX "idx_qg_event_triggered" ON "quality_gate_events" ("triggeredAt");
CREATE INDEX "idx_qg_event_machine" ON "quality_gate_events" ("machineId");
