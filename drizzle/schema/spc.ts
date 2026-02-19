// Schema domain: SPC & Quality Gate tables
import { pgTable, pgEnum, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { comparisonOperatorEnum } from "./enums";

// ─── New Enums ───────────────────────────────────────────────────────────────

export const spcChartTypeEnum = pgEnum("spc_chart_type_enum", [
  "xbar_r", "xbar_s", "individual_mr", "p_chart", "np_chart", "c_chart", "u_chart"
]);

export const spcRuleTypeEnum = pgEnum("spc_rule_type_enum", [
  "western_electric_1", "western_electric_2", "western_electric_3", "western_electric_4",
  "nelson_1", "nelson_2", "nelson_3", "nelson_4",
  "nelson_5", "nelson_6", "nelson_7", "nelson_8"
]);

export const spcSeverityEnum = pgEnum("spc_severity_enum", ["info", "warning", "critical"]);

export const qualityGateTypeEnum = pgEnum("quality_gate_type_enum", [
  "yield_rate", "ng_count", "ng_rate", "cpk_threshold", "consecutive_ng"
]);

export const qualityGateActionEnum = pgEnum("quality_gate_action_enum", ["alert", "pause", "stop"]);

export const qualityGateEventStatusEnum = pgEnum("quality_gate_event_status_enum", [
  "active", "acknowledged", "resolved", "auto_resolved"
]);

// ─── SPC Configurations ─────────────────────────────────────────────────────

export const spcConfigurations = pgTable("spc_configurations", {
  id: serial("id").primaryKey(),
  measurementPointDefId: integer("measurementPointDefId"),
  workstationId: integer("workstationId"),
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  chartType: spcChartTypeEnum("chartType").default("xbar_r").notNull(),
  subgroupSize: integer("subgroupSize").default(5).notNull(),
  controlLimitMethod: varchar("controlLimitMethod", { length: 20 }).default("auto").notNull(),
  manualUCL: decimal("manualUCL", { precision: 15, scale: 6 }),
  manualLCL: decimal("manualLCL", { precision: 15, scale: 6 }),
  manualCenterLine: decimal("manualCenterLine", { precision: 15, scale: 6 }),
  movingRangeSpan: integer("movingRangeSpan").default(2),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_spc_config_point").on(table.measurementPointDefId),
  index("idx_spc_config_workstation").on(table.workstationId),
  index("idx_spc_config_product").on(table.productModelId),
  index("idx_spc_config_active").on(table.isActive),
]);

export type SpcConfiguration = typeof spcConfigurations.$inferSelect;
export type InsertSpcConfiguration = typeof spcConfigurations.$inferInsert;

// ─── SPC Rule Violations ────────────────────────────────────────────────────

export const spcRuleViolations = pgTable("spc_rule_violations", {
  id: serial("id").primaryKey(),
  measurementPointDefId: integer("measurementPointDefId"),
  workstationId: integer("workstationId"),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  ruleType: spcRuleTypeEnum("ruleType").notNull(),
  ruleName: varchar("ruleName", { length: 255 }).notNull(),
  ruleDescription: text("ruleDescription"),
  severity: spcSeverityEnum("severity").default("warning").notNull(),
  violatingValues: json("violatingValues"),
  subgroupIndices: json("subgroupIndices"),
  controlLimits: json("controlLimits"),
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedBy: integer("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolutionNotes: text("resolutionNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_spc_violations_point").on(table.measurementPointDefId),
  index("idx_spc_violations_workstation").on(table.workstationId),
  index("idx_spc_violations_rule").on(table.ruleType),
  index("idx_spc_violations_severity").on(table.severity),
  index("idx_spc_violations_active").on(table.isActive),
  index("idx_spc_violations_detected").on(table.detectedAt),
]);

export type SpcRuleViolation = typeof spcRuleViolations.$inferSelect;
export type InsertSpcRuleViolation = typeof spcRuleViolations.$inferInsert;

// ─── CPK History ────────────────────────────────────────────────────────────

export const cpkHistory = pgTable("cpk_history", {
  id: serial("id").primaryKey(),
  measurementPointDefId: integer("measurementPointDefId").notNull(),
  workstationId: integer("workstationId"),
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  sampleSize: integer("sampleSize").notNull(),
  mean: decimal("mean", { precision: 15, scale: 6 }).notNull(),
  stdDev: decimal("stdDev", { precision: 15, scale: 6 }).notNull(),
  cp: decimal("cp", { precision: 10, scale: 4 }),
  cpk: decimal("cpk", { precision: 10, scale: 4 }),
  pp: decimal("pp", { precision: 10, scale: 4 }),
  ppk: decimal("ppk", { precision: 10, scale: 4 }),
  cpl: decimal("cpl", { precision: 10, scale: 4 }),
  cpu: decimal("cpu", { precision: 10, scale: 4 }),
  usl: decimal("usl", { precision: 15, scale: 6 }),
  lsl: decimal("lsl", { precision: 15, scale: 6 }),
  nominal: decimal("nominal", { precision: 15, scale: 6 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_cpk_history_point").on(table.measurementPointDefId),
  index("idx_cpk_history_workstation").on(table.workstationId),
  index("idx_cpk_history_product").on(table.productModelId),
  index("idx_cpk_history_period").on(table.periodStart, table.periodEnd),
  index("idx_cpk_history_cpk").on(table.cpk),
]);

export type CpkHistory = typeof cpkHistory.$inferSelect;
export type InsertCpkHistory = typeof cpkHistory.$inferInsert;

// ─── Correlation Analyses ───────────────────────────────────────────────────

export const correlationAnalyses = pgTable("correlation_analyses", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId"),
  workstationId: integer("workstationId"),
  machineId: integer("machineId"),
  pointIds: json("pointIds").notNull(),
  correlationMatrix: json("correlationMatrix").notNull(),
  sampleSize: integer("sampleSize").notNull(),
  analysisDate: timestamp("analysisDate").notNull(),
  significanceLevel: decimal("significanceLevel", { precision: 5, scale: 4 }).default("0.05"),
  strongCorrelations: json("strongCorrelations"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_correlation_product").on(table.productModelId),
  index("idx_correlation_workstation").on(table.workstationId),
  index("idx_correlation_date").on(table.analysisDate),
]);

export type CorrelationAnalysis = typeof correlationAnalyses.$inferSelect;
export type InsertCorrelationAnalysis = typeof correlationAnalyses.$inferInsert;

// ─── Quality Gates ──────────────────────────────────────────────────────────

export const qualityGates = pgTable("quality_gates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  lineId: integer("lineId"),
  workstationId: integer("workstationId"),
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  gateType: qualityGateTypeEnum("gateType").notNull(),
  threshold: decimal("threshold", { precision: 10, scale: 4 }).notNull(),
  comparisonOperator: comparisonOperatorEnum("comparisonOperator").default("lt").notNull(),
  windowSize: integer("windowSize").default(100),
  consecutiveCount: integer("consecutiveCount").default(3),
  action: qualityGateActionEnum("action").default("alert").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  autoResumeAfterMinutes: integer("autoResumeAfterMinutes"),
  notifyRoles: json("notifyRoles"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_quality_gate_line").on(table.lineId),
  index("idx_quality_gate_workstation").on(table.workstationId),
  index("idx_quality_gate_product").on(table.productModelId),
  index("idx_quality_gate_active").on(table.isActive),
  index("idx_quality_gate_type").on(table.gateType),
]);

export type QualityGate = typeof qualityGates.$inferSelect;
export type InsertQualityGate = typeof qualityGates.$inferInsert;

// ─── Quality Gate Events ────────────────────────────────────────────────────

export const qualityGateEvents = pgTable("quality_gate_events", {
  id: serial("id").primaryKey(),
  qualityGateId: integer("qualityGateId").notNull(),
  triggeredAt: timestamp("triggeredAt").defaultNow().notNull(),
  triggerValue: decimal("triggerValue", { precision: 10, scale: 4 }).notNull(),
  threshold: decimal("threshold", { precision: 10, scale: 4 }).notNull(),
  action: qualityGateActionEnum("action").notNull(),
  status: qualityGateEventStatusEnum("status").default("active").notNull(),
  machineId: integer("machineId"),
  productionOrderId: integer("productionOrderId"),
  affectedCount: integer("affectedCount").default(0),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"),
  autoResolved: boolean("autoResolved").default(false),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_qg_event_gate").on(table.qualityGateId),
  index("idx_qg_event_status").on(table.status),
  index("idx_qg_event_triggered").on(table.triggeredAt),
  index("idx_qg_event_machine").on(table.machineId),
]);

export type QualityGateEvent = typeof qualityGateEvents.$inferSelect;
export type InsertQualityGateEvent = typeof qualityGateEvents.$inferInsert;
