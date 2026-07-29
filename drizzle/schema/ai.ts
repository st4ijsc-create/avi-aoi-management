// Schema domain: AI & Annotation tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, jsonb, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * pgvector `vector(N)` column type.
 *
 * Drizzle không có native vector type, nên khai báo qua customType để TS biết
 * cột tồn tại. Giá trị đọc/ghi ở dạng chuỗi `"[v1,v2,...]"` (đúng định dạng
 * pgvector). Dimension được nhúng vào DDL qua dataType().
 *
 * LƯU Ý: index HNSW cho cột này KHÔNG khai báo ở đây — nó được giữ thủ công
 * trong migration SQL (drizzle/0091_image_embeddings_pgvector.sql) vì
 * drizzle-kit không sinh được `USING hnsw (... vector_cosine_ops)`.
 */
const pgvector = (dimensions: number) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
  });
import { changeTypeEnum, alertTypeEnum_1, maintenanceUrgencyEnum, statusEnum_5, analysisTypeEnum, statusEnum_6, statusEnum_8, periodTypeEnum_1, suggestionTypeEnum, statusEnum_9, feedbackTypeEnum, errorCategoryEnum, accuracyTrendEnum, exportFormatEnum_1, statusEnum_10, modelFormatEnum, modelStatusEnum, inferenceStatusEnum, batchJobStatusEnum, batchItemStatusEnum, abTestStatusEnum, abTestVariantEnum, abTestWinnerEnum, driftAlertTypeEnum, driftSeverityEnum, edgeDeployStatusEnum, trainingJobStatusEnum, aiDecisionEnum, ensembleStrategyEnum, labelQueueStatusEnum, samplingStrategyEnum, chatRoleEnum, apiKeyProviderEnum, apiKeyStatusEnum, aiPendingActionStatusEnum, agentSessionStatusEnum } from "./enums";

// ============= Image Annotations =============
export const imageAnnotations = pgTable("image_annotations", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId"),
  measurementResultId: integer("measurementResultId"),
  imageUrl: text("imageUrl").notNull(),
  annotations: json("annotations").$type<Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
    points?: Array<{x: number; y: number}>;
    text?: string;
    color: string;
    strokeWidth?: number;
  }>>(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_image_annotations_image_url").on(table.imageUrl),
  index("idx_image_annotations_inspection").on(table.inspectionId),
  index("idx_image_annotations_created_by").on(table.createdBy),
  index("idx_image_annotations_created_at").on(table.createdAt),
]);

export type ImageAnnotation = typeof imageAnnotations.$inferSelect;
export type InsertImageAnnotation = typeof imageAnnotations.$inferInsert;

export const annotationHistory = pgTable("annotation_history", {
  id: serial("id").primaryKey(),
  annotationId: integer("annotationId").notNull(), // FK to image_annotations
  imageUrl: text("imageUrl").notNull(),
  versionNumber: integer("versionNumber").notNull(), // Auto-increment per annotation
  annotations: json("annotations").$type<Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    radius?: number;
    points?: Array<{x: number; y: number}>;
    text?: string;
    color: string;
    strokeWidth?: number;
  }>>().notNull(),
  changeType: changeTypeEnum("changeType").notNull(),
  changeSummary: text("changeSummary"), // Human-readable summary of changes
  changedBy: integer("changedBy").notNull(), // FK to users
  changedByName: varchar("changedByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_annotation_history_annotation").on(table.annotationId),
  index("idx_annotation_history_image").on(table.imageUrl),
  index("idx_annotation_history_version").on(table.annotationId, table.versionNumber),
  index("idx_annotation_history_created").on(table.createdAt),
  index("idx_annotation_history_user").on(table.changedBy),
]);

export type AnnotationHistory = typeof annotationHistory.$inferSelect;
export type InsertAnnotationHistory = typeof annotationHistory.$inferInsert;


// ============= Predictive Maintenance Alerts =============

/**
 * Predictive Alerts - Cảnh báo dự đoán từ AI
 */
export const predictiveAlerts = pgTable("predictive_alerts", {
  id: serial("id").primaryKey(),
  alertType: alertTypeEnum_1("alertType").notNull(),
  severity: maintenanceUrgencyEnum("severity").default("MEDIUM").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  // Prediction details
  predictedValue: decimal("predictedValue", { precision: 10, scale: 4 }), // Giá trị dự đoán
  currentValue: decimal("currentValue", { precision: 10, scale: 4 }), // Giá trị hiện tại
  threshold: decimal("threshold", { precision: 10, scale: 4 }), // Ngưỡng cảnh báo
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }), // Độ tin cậy (0-100)
  predictedTimeframe: varchar("predictedTimeframe", { length: 50 }), // e.g., "next 24 hours", "within 7 days"
  // Related entities
  machineId: integer("machineId"),
  machineCode: varchar("machineCode", { length: 50 }),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // AI analysis
  aiAnalysis: json("aiAnalysis").$type<{
    factors: Array<{name: string; contribution: number; description: string}>;
    recommendations: string[];
    dataPoints: number;
    modelUsed: string;
  }>(),
  // Status
  status: statusEnum_5("status").default("ACTIVE").notNull(),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedBy: integer("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolutionNotes: text("resolutionNotes"),
  // Notification
  notificationSent: boolean("notificationSent").default(false).notNull(),
  notificationSentAt: timestamp("notificationSentAt"),
  // Escalation tracking (0=none, 1=supervisor, 2=manager, 3=executive)
  escalationLevel: integer("escalationLevel").default(0).notNull(),
  lastEscalatedAt: timestamp("lastEscalatedAt"),
  // ── W0-F G5.5 (doc 44, migration 0249; additive, nullable) ──
  // runbook_ref: pointer to the runbook/SOP for THIS alert (e.g. an SLO target's
  // runbook path or a doc/KB id). recommendation_ref: pointer to a recommended
  // action/AI-proposal record. Written only when the raiser actually has one
  // (SLO burn-rate alerts carry their catalogue runbook) — never fabricated.
  runbookRef: text("runbook_ref"),
  recommendationRef: text("recommendation_ref"),
  // Wave 3 §3 — số lần tình trạng này tái diễn khi cảnh báo vẫn đang mở.
  occurrenceCount: integer("occurrenceCount").notNull().default(1),
  lastOccurredAt: timestamp("lastOccurredAt", { withTimezone: true }),
  // Timestamps
  expiresAt: timestamp("expiresAt"), // Alert expiration
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_predictive_alerts_type").on(table.alertType),
  index("idx_predictive_alerts_severity").on(table.severity),
  index("idx_predictive_alerts_status").on(table.status),
  index("idx_predictive_alerts_machine").on(table.machineId),
  index("idx_predictive_alerts_product").on(table.productModelId),
  index("idx_predictive_alerts_factory").on(table.factoryId),
  index("idx_predictive_alerts_created").on(table.createdAt),
  index("idx_predictive_alerts_expires").on(table.expiresAt),
  index("idx_predictive_alerts_escalation").on(table.escalationLevel),
]);

export type PredictiveAlert = typeof predictiveAlerts.$inferSelect;
export type InsertPredictiveAlert = typeof predictiveAlerts.$inferInsert;

/** Wave 4 §3 — mỗi lần tình trạng tái diễn = một dòng có mốc thời gian riêng. */
export const predictiveAlertOccurrences = pgTable("predictive_alert_occurrences", {
  id: serial("id").primaryKey(),
  alertId: integer("alertId").notNull().references(() => predictiveAlerts.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).notNull().defaultNow(),
  severity: varchar("severity", { length: 20 }),
  confidenceScore: decimal("confidenceScore", { precision: 5, scale: 2 }),
}, (table) => [
  index("idx_alert_occurrences_time").on(table.occurredAt),
  index("idx_alert_occurrences_alert").on(table.alertId),
]);

export type PredictiveAlertOccurrence = typeof predictiveAlertOccurrences.$inferSelect;
export type InsertPredictiveAlertOccurrence = typeof predictiveAlertOccurrences.$inferInsert;

/**
 * Alert Escalations - Audit log of all escalation events
 */
export const alertEscalations = pgTable("alert_escalations", {
  id: serial("id").primaryKey(),
  alertId: integer("alertId").notNull(),
  fromLevel: integer("fromLevel").notNull(),
  toLevel: integer("toLevel").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  notifiedUserIds: json("notifiedUserIds").$type<number[]>().default([]),
  escalatedAt: timestamp("escalatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_alert_esc_alert").on(table.alertId),
  index("idx_alert_esc_at").on(table.escalatedAt),
]);


// ============= Root Cause Analysis =============

/**
 * Root Cause Analysis Results - Kết quả phân tích nguyên nhân gốc rễ
 */
export const rootCauseAnalysis = pgTable("root_cause_analysis", {
  id: serial("id").primaryKey(),
  analysisType: analysisTypeEnum("analysisType").notNull(),
  // Scope
  machineId: integer("machineId"),
  machineCode: varchar("machineCode", { length: 50 }),
  productModelId: integer("productModelId"),
  productModelCode: varchar("productModelCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // Time range analyzed
  startDate: timestamp("startDate").notNull(),
  endDate: timestamp("endDate").notNull(),
  // Analysis results
  dataPointsAnalyzed: integer("dataPointsAnalyzed").notNull(),
  correlationMatrix: json("correlationMatrix").$type<Array<{
    factor1: string;
    factor2: string;
    correlation: number; // -1 to 1
    significance: number; // p-value
  }>>(),
  topFactors: json("topFactors").$type<Array<{
    factor: string;
    contribution: number; // Percentage contribution
    description: string;
    trend: "increasing" | "decreasing" | "stable";
  }>>().notNull(),
  // AI insights
  aiInsights: json("aiInsights").$type<{
    summary: string;
    rootCauses: Array<{cause: string; probability: number; evidence: string}>;
    // W0-1 (doc 69): was declared as Array<{action;priority;expectedImpact}>,
    // but the actual producer (aiInsightsService.generateRCAInsights — used by
    // both rootCauseRouter.analyze and aiBatchRcaScheduler) has always emitted
    // a flat string[] (see aiBatchRcaScheduler.ts's `.join("; ")` on this
    // field). The prior raw-SQL INSERT never type-checked this, masking the
    // mismatch. aiRcaCopilot.persistRca's richer per-recommendation object is
    // written via an explicit `as any` and is unaffected by this correction.
    recommendations: string[];
    preventiveMeasures: string[];
  }>(),
  // Pareto analysis
  paretoData: json("paretoData").$type<Array<{
    category: string;
    count: number;
    percentage: number;
    cumulativePercentage: number;
  }>>(),
  // Status
  status: statusEnum_6("status").default("COMPLETED").notNull(),
  errorMessage: text("errorMessage"),
  // Metadata
  requestedBy: integer("requestedBy").notNull(),
  requestedByName: varchar("requestedByName", { length: 255 }),
  processingTime: integer("processingTime"), // Milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_rca_type").on(table.analysisType),
  index("idx_rca_machine").on(table.machineId),
  index("idx_rca_product").on(table.productModelId),
  index("idx_rca_factory").on(table.factoryId),
  index("idx_rca_status").on(table.status),
  index("idx_rca_created").on(table.createdAt),
  index("idx_rca_date_range").on(table.startDate, table.endDate),
]);

export type RootCauseAnalysis = typeof rootCauseAnalysis.$inferSelect;
export type InsertRootCauseAnalysis = typeof rootCauseAnalysis.$inferInsert;


// ============ PHASE 163: ANNOTATION COMPARISON, DEFECT HEATMAP, AI FEEDBACK ============

/**
 * Annotation Comparison Sessions - Phiên so sánh annotations
 */
export const annotationComparisonSessions = pgTable("annotation_comparison_sessions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Scope
  productModelId: integer("productModelId"),
  serialNumber: varchar("serialNumber", { length: 100 }),
  machineId: integer("machineId"),
  // Inspections to compare
  inspectionIds: json("inspectionIds").$type<number[]>().notNull(),
  // Comparison result
  comparisonResult: json("comparisonResult").$type<{
    totalAnnotations: number;
    matchingAnnotations: number;
    newAnnotations: number;
    removedAnnotations: number;
    modifiedAnnotations: number;
    matchPercentage: number;
    patterns: Array<{
      type: string;
      description: string;
      affectedPoints: number[];
    }>;
    timeline: Array<{
      inspectionId: number;
      timestamp: string;
      annotationCount: number;
      changes: string[];
    }>;
  }>(),
  // Pattern detection
  detectedPatterns: json("detectedPatterns").$type<Array<{
    id: string;
    name: string;
    type: "recurring" | "progressive" | "intermittent" | "new";
    severity: "critical" | "warning" | "info";
    description: string;
    affectedArea: { x: number; y: number; width: number; height: number };
    frequency: number;
    firstSeen: string;
    lastSeen: string;
    recommendations: string[];
  }>>(),
  // Status
  status: statusEnum_8("status").default("PENDING").notNull(),
  errorMessage: text("errorMessage"),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_comparison_product").on(table.productModelId),
  index("idx_comparison_serial").on(table.serialNumber),
  index("idx_comparison_machine").on(table.machineId),
  index("idx_comparison_status").on(table.status),
  index("idx_comparison_created").on(table.createdAt),
]);

export type AnnotationComparisonSession = typeof annotationComparisonSessions.$inferSelect;
export type InsertAnnotationComparisonSession = typeof annotationComparisonSessions.$inferInsert;

/**
 * Defect Heatmap Data - Dữ liệu heatmap defects
 */
export const defectHeatmapData = pgTable("defect_heatmap_data", {
  id: serial("id").primaryKey(),
  // Scope
  factoryId: integer("factoryId"),
  workshopId: integer("workshopId"),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  // Time period
  periodType: periodTypeEnum_1("periodType").notNull(),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Heatmap grid
  gridWidth: integer("gridWidth").notNull(),
  gridHeight: integer("gridHeight").notNull(),
  heatmapGrid: json("heatmapGrid").$type<number[][]>().notNull(),
  // Statistics
  totalDefects: integer("totalDefects").default(0).notNull(),
  maxDefectsInCell: integer("maxDefectsInCell").default(0).notNull(),
  // Hotspots
  hotspots: json("hotspots").$type<Array<{
    x: number;
    y: number;
    defectCount: number;
    defectTypes: Array<{ type: string; count: number }>;
    percentage: number;
  }>>(),
  // Top locations
  topLocations: json("topLocations").$type<Array<{
    gridX: number;
    gridY: number;
    realX: number;
    realY: number;
    defectCount: number;
    defectTypes: string[];
    trend: "increasing" | "decreasing" | "stable";
  }>>(),
  // Metadata
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
  processingTimeMs: integer("processingTimeMs"),
}, (table) => [
  index("idx_heatmap_factory").on(table.factoryId),
  index("idx_heatmap_machine").on(table.machineId),
  index("idx_heatmap_product").on(table.productModelId),
  index("idx_heatmap_period").on(table.periodType),
  index("idx_heatmap_generated").on(table.generatedAt),
]);

export type DefectHeatmapData = typeof defectHeatmapData.$inferSelect;
export type InsertDefectHeatmapData = typeof defectHeatmapData.$inferInsert;

/**
 * AI Suggestions - Gợi ý từ AI
 */
export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  // Context
  inspectionId: integer("inspectionId").notNull(),
  measurementResultId: integer("measurementResultId"),
  // Suggestion
  suggestionType: suggestionTypeEnum("suggestionType").notNull(),
  suggestion: text("suggestion").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  reasoning: text("reasoning"),
  // Alternatives
  alternatives: json("alternatives").$type<Array<{
    suggestion: string;
    confidence: number;
  }>>(),
  // Model info
  modelVersion: varchar("modelVersion", { length: 50 }).notNull(),
  modelName: varchar("modelName", { length: 100 }).notNull(),
  // Status
  status: statusEnum_9("status").default("PENDING").notNull(),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_suggestion_inspection").on(table.inspectionId),
  index("idx_ai_suggestion_type").on(table.suggestionType),
  index("idx_ai_suggestion_status").on(table.status),
  index("idx_ai_suggestion_model").on(table.modelName, table.modelVersion),
]);

export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type InsertAiSuggestion = typeof aiSuggestions.$inferInsert;

/**
 * AI Feedback - Phản hồi của user cho AI suggestions
 */
export const aiFeedback = pgTable("ai_feedback", {
  id: serial("id").primaryKey(),
  suggestionId: integer("suggestionId").notNull(),
  // Feedback
  feedbackType: feedbackTypeEnum("feedbackType").notNull(),
  accuracy: integer("accuracy"), // 0-100
  correctedValue: text("correctedValue"),
  correctionNotes: text("correctionNotes"),
  // Error categorization
  errorCategory: errorCategoryEnum("errorCategory"),
  // Training data
  includedInTraining: boolean("includedInTraining").default(false).notNull(),
  trainingBatchId: varchar("trainingBatchId", { length: 100 }),
  // Metadata
  feedbackBy: integer("feedbackBy").notNull(),
  feedbackByName: varchar("feedbackByName", { length: 255 }),
  feedbackAt: timestamp("feedbackAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_feedback_suggestion").on(table.suggestionId),
  index("idx_ai_feedback_type").on(table.feedbackType),
  index("idx_ai_feedback_training").on(table.includedInTraining),
  index("idx_ai_feedback_batch").on(table.trainingBatchId),
]);

export type AiFeedback = typeof aiFeedback.$inferSelect;
export type InsertAiFeedback = typeof aiFeedback.$inferInsert;

/**
 * AI Model Metrics - Metrics cho AI models
 */
export const aiModelMetrics = pgTable("ai_model_metrics", {
  id: serial("id").primaryKey(),
  modelName: varchar("modelName", { length: 100 }).notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }).notNull(),
  // Time period
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Metrics
  totalSuggestions: integer("totalSuggestions").default(0).notNull(),
  reviewedSuggestions: integer("reviewedSuggestions").default(0).notNull(),
  correctCount: integer("correctCount").default(0).notNull(),
  incorrectCount: integer("incorrectCount").default(0).notNull(),
  partialCount: integer("partialCount").default(0).notNull(),
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }),
  // Breakdown by type
  metricsByType: json("metricsByType").$type<Array<{
    suggestionType: string;
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number;
  }>>(),
  // Error breakdown
  errorBreakdown: json("errorBreakdown").$type<Array<{
    category: string;
    count: number;
    percentage: number;
  }>>(),
  // Trend
  accuracyTrend: accuracyTrendEnum("accuracyTrend").default("STABLE"),
  // Metadata
  generatedAt: timestamp("generatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_metrics_model").on(table.modelName, table.modelVersion),
  index("idx_ai_metrics_period").on(table.periodStart, table.periodEnd),
]);

export type AiModelMetrics = typeof aiModelMetrics.$inferSelect;
export type InsertAiModelMetrics = typeof aiModelMetrics.$inferInsert;

/**
 * AI Training Batches - Batches cho training AI
 */
export const aiTrainingBatches = pgTable("ai_training_batches", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Content
  feedbackCount: integer("feedbackCount").default(0).notNull(),
  correctSamples: integer("correctSamples").default(0).notNull(),
  incorrectSamples: integer("incorrectSamples").default(0).notNull(),
  // Export
  exportFormat: exportFormatEnum_1("exportFormat").default("JSONL").notNull(),
  exportUrl: text("exportUrl"),
  // Status
  status: statusEnum_10("status").default("PENDING").notNull(),
  // Target model
  targetModelName: varchar("targetModelName", { length: 100 }),
  targetModelVersion: varchar("targetModelVersion", { length: 50 }),
  // Metadata
  createdBy: integer("createdBy").notNull(),
  createdByName: varchar("createdByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_training_batch_id").on(table.batchId),
  index("idx_training_batch_status").on(table.status),
  index("idx_training_batch_created").on(table.createdAt),
]);

export type AiTrainingBatch = typeof aiTrainingBatches.$inferSelect;
export type InsertAiTrainingBatch = typeof aiTrainingBatches.$inferInsert;


/**
 * Training Batch Comments - Nhận xét cho từng lô đào tạo AI
 */
export const trainingBatchComments = pgTable("training_batch_comments", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull(),
  userId: integer("userId").notNull(),
  userName: varchar("userName", { length: 255 }),
  content: text("content").notNull(),
  parentId: integer("parentId"), // For nested comments/replies
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_comment_batch").on(table.batchId),
  index("idx_batch_comment_user").on(table.userId),
  index("idx_batch_comment_parent").on(table.parentId),
]);

export type TrainingBatchComment = typeof trainingBatchComments.$inferSelect;
export type InsertTrainingBatchComment = typeof trainingBatchComments.$inferInsert;

/**
 * Training Batch Tags - Thẻ cho phân loại lô đào tạo
 */
export const trainingBatchTags = pgTable("training_batch_tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  color: varchar("color", { length: 20 }).default("#3b82f6").notNull(), // Hex color
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_tag_name").on(table.name),
]);

export type TrainingBatchTag = typeof trainingBatchTags.$inferSelect;
export type InsertTrainingBatchTag = typeof trainingBatchTags.$inferInsert;

/**
 * Training Batch Tag Assignments - Gán thẻ cho lô đào tạo
 */
export const trainingBatchTagAssignments = pgTable("training_batch_tag_assignments", {
  id: serial("id").primaryKey(),
  batchId: varchar("batchId", { length: 100 }).notNull(),
  tagId: integer("tagId").notNull(),
  assignedBy: integer("assignedBy").notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_batch_tag_assign_batch").on(table.batchId),
  index("idx_batch_tag_assign_tag").on(table.tagId),
]);

export type TrainingBatchTagAssignment = typeof trainingBatchTagAssignments.$inferSelect;
export type InsertTrainingBatchTagAssignment = typeof trainingBatchTagAssignments.$inferInsert;


// ============ AI MODEL MANAGEMENT — Offline AI Integration ============

/**
 * AI Models - Registry quản lý ML models cho offline inference
 */
export const aiModels = pgTable("ai_models", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelType: varchar("modelType", { length: 100 }).notNull(), // e.g. "classification", "detection", "segmentation"
  format: modelFormatEnum("format").default("ONNX").notNull(),
  currentVersion: varchar("currentVersion", { length: 50 }),
  filePath: text("filePath"),
  fileKey: varchar("fileKey", { length: 255 }),
  fileSize: integer("fileSize"),
  // ── WS-2 (additive, nullable) — integrity hash for edge package verification ──
  fileHash: varchar("fileHash", { length: 128 }),
  inputShape: json("inputShape").$type<number[]>(), // e.g. [1, 3, 224, 224]
  outputShape: json("outputShape").$type<number[]>(), // e.g. [1, 1000]
  labels: json("labels").$type<string[]>(), // e.g. ["OK", "NG_scratch", "NG_crack"]
  preprocessConfig: json("preprocessConfig").$type<{
    resize?: { width: number; height: number };
    normalize?: { mean: number[]; std: number[] };
    colorSpace?: "RGB" | "BGR" | "GRAY";
    channelFirst?: boolean;
  }>(),
  postprocessConfig: json("postprocessConfig").$type<{
    type: "classification" | "detection" | "segmentation";
    confidenceThreshold?: number;
    nmsThreshold?: number;
    topK?: number;
    // ── B2 (additive, optional) — confidence calibration ──
    // Temperature scaling factor applied to logits before softmax.
    // T > 1 softens overconfident logits; T < 1 sharpens. Absent/1 ⇒ identity
    // (no behaviour change). aiInferenceEngine already reads this (was via `as any`).
    temperatureScale?: number;
  }>(),
  status: modelStatusEnum("status").default("UPLOADING").notNull(),
  metadata: json("metadata"),
  productModelId: integer("productModelId"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_models_code").on(table.code),
  index("idx_ai_models_type").on(table.modelType),
  index("idx_ai_models_format").on(table.format),
  index("idx_ai_models_status").on(table.status),
  index("idx_ai_models_product").on(table.productModelId),
]);

export type AiModel = typeof aiModels.$inferSelect;
export type InsertAiModel = typeof aiModels.$inferInsert;

/**
 * Model Versions - Lịch sử phiên bản model
 */
export const modelVersions = pgTable("model_versions", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  filePath: text("filePath"),
  fileKey: varchar("fileKey", { length: 255 }),
  fileSize: integer("fileSize"),
  // ── WS-2 (additive, nullable) — sha256 of the model file (two-sided verify) ──
  fileHash: varchar("fileHash", { length: 128 }),
  changeLog: text("changeLog"),
  metrics: json("metrics").$type<{
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1Score?: number;
    inferenceTimeMs?: number;
    [key: string]: unknown;
  }>(),
  accuracy: decimal("accuracy", { precision: 5, scale: 2 }),
  status: modelStatusEnum("status").default("UPLOADING").notNull(),
  // ── WS-1 (additive, nullable) ──
  datasetId: integer("datasetId"),                 // training_datasets.id used to train
  baselineVersionId: integer("baselineVersionId"), // version compared against for the gate
  evalReport: json("evalReport"),                  // full before/after CompareReport
  // ── W5-A4 G4.24 (doc 44, migration 0262; additive, nullable) — Model Registry STAGE ──
  // MLOps lifecycle stage (SYNAPSE LDS-L4 §11.1). null = legacy version (no stage).
  // Projection is explicit: status=ACTIVE ⇔ stage='production' (see aiModelService).
  stage: text("stage").$type<ModelStage>(),
  // Append-only stage-transition ledger — every promoteStage/activate appends here.
  stageHistory: jsonb("stage_history").$type<ModelStageHistoryEntry[]>(),
  // When the version entered its CURRENT stage — measures the shadow ≥ N-hour gate.
  stageEnteredAt: timestamp("stage_entered_at"),
  // ── ModelCard §12.2 (additive, nullable) ──
  owner: varchar("owner", { length: 255 }),        // ModelCard.owner (owning team)
  trainedOn: text("trained_on"),                   // ModelCard.trained_on (training data window)
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_model_versions_model").on(table.modelId),
  index("idx_model_versions_version").on(table.modelId, table.version),
  index("idx_model_versions_status").on(table.status),
]);

/** MLOps lifecycle stage (SYNAPSE LDS-L4 §11.1 + Model Registry §3.2). */
export type ModelStage = "staging" | "shadow" | "canary" | "production" | "retired";

/** One append-only entry in model_versions.stage_history. */
export interface ModelStageHistoryEntry {
  from: ModelStage | null;
  to: ModelStage;
  at: string;               // ISO timestamp
  actor?: number | null;    // user id that performed the transition
  approver?: number | null; // second approver (canary→production 2-person rule)
  via: string;              // "promote" | "activate" | "rollback" | "manual"
  reason?: string;
}

export type ModelVersion = typeof modelVersions.$inferSelect;
export type InsertModelVersion = typeof modelVersions.$inferInsert;

// ============= AI Model Cards — governance (doc69 D3, Giai đoạn 4/Wave 3) =============
// The full ModelCard §12.2 governance record — ONE per model (keyed by modelId), the
// SOURCE OF TRUTH for governance metadata. Subsumes (does not contradict) the existing
// inline `modelVersions.owner`/`trainedOn` fields above: those stay populated for
// back-compat / legacy versions, and aiModelRouter.createCard falls back to the latest
// version's inline `owner` when the card doesn't specify one explicitly.
//
// ── Distinct from server/services/aiModelCard.ts (B5.4, doc 04 AI Brain NextGen) ──
// That EARLIER module (singular `ModelCard` type, `ai_models.metadata.modelCard` JSON,
// no migration) is an AUTO-GENERATED, ungated documentation card for the LLM/vision
// BRAIN portfolio (Qwen3 etc. — most of which have no ai_models row at all): role/
// source/quant/contextSize, no approval, never blocks anything. THIS table is the
// OPPOSITE shape: a HUMAN-AUTHORED, APPROVED governance record for a defect-classifier
// model that — once AI_MODEL_CARD_REQUIRED is on — actively GATES version activation
// (see aiModelCardGate.ts). The two do not read or write each other; keep them separate.
//
// Additive migration: drizzle/0303_ai_model_cards.sql (CREATE TABLE IF NOT EXISTS, owner
// `aoi`) — NOT applied by this task, ships unapplied until an operator runs it. Every
// read/write path MUST treat a missing table (pg error 42P01) as "no card" / a clean
// PRECONDITION_FAILED — see server/services/aiModelCardGate.ts's getModelCardStatus() and
// aiModelRouter.ts's card CRUD handlers. Never referenced unconditionally on a hot path
// that must survive an unmigrated DB.
export type ModelCardRiskClass = "low" | "medium" | "high";

export const aiModelCards = pgTable("ai_model_cards", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull().unique(), // one governance card per ai_models row
  intendedUse: text("intendedUse"),
  trainingDataDesc: text("trainingDataDesc"),
  evalSummary: text("evalSummary"),
  limitations: text("limitations"),
  riskClass: varchar("riskClass", { length: 20 }).$type<ModelCardRiskClass>(),
  owner: varchar("owner", { length: 255 }),
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_model_cards_model").on(table.modelId),
]);

export type AiModelCard = typeof aiModelCards.$inferSelect;
export type InsertAiModelCard = typeof aiModelCards.$inferInsert;

/**
 * Inference Results - Kết quả inference từ ML models
 */
export const inferenceResults = pgTable("inference_results", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  inspectionId: integer("inspectionId"),
  measurementResultId: integer("measurementResultId"),
  inputType: varchar("inputType", { length: 50 }).default("image").notNull(), // image, tensor, raw
  inputReference: text("inputReference"), // URL or path to input data
  predictions: json("predictions").$type<Array<{
    label: string;
    confidence: number;
    bbox?: { x: number; y: number; width: number; height: number };
    mask?: string; // base64 encoded mask for segmentation
  }>>().notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  topLabel: varchar("topLabel", { length: 100 }),
  processingTimeMs: integer("processingTimeMs"),
  status: inferenceStatusEnum("status").default("COMPLETED").notNull(),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_inference_results_model").on(table.modelId),
  index("idx_inference_results_inspection").on(table.inspectionId),
  index("idx_inference_results_measurement").on(table.measurementResultId),
  index("idx_inference_results_status").on(table.status),
  index("idx_inference_results_created").on(table.createdAt),
]);

export type InferenceResult = typeof inferenceResults.$inferSelect;
export type InsertInferenceResult = typeof inferenceResults.$inferInsert;

// ============= Batch Inference =============

export const batchInferenceJobs = pgTable("batch_inference_jobs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  status: batchJobStatusEnum("status").default("PENDING").notNull(),
  totalItems: integer("totalItems").default(0).notNull(),
  completedItems: integer("completedItems").default(0).notNull(),
  failedItems: integer("failedItems").default(0).notNull(),
  concurrency: integer("concurrency").default(4).notNull(),
  priority: integer("priority").default(5).notNull(),
  resultsSummary: json("resultsSummary").$type<{
    labelCounts: Record<string, number>;
    avgConfidence: number;
    avgProcessingTimeMs: number;
    topDefects: Array<{ label: string; count: number; percentage: number }>;
  }>(),
  errorLog: text("errorLog"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_batch_jobs_model").on(table.modelId),
  index("idx_batch_jobs_status").on(table.status),
  index("idx_batch_jobs_created").on(table.createdAt),
]);

export type BatchInferenceJob = typeof batchInferenceJobs.$inferSelect;
export type InsertBatchInferenceJob = typeof batchInferenceJobs.$inferInsert;

export const batchInferenceItems = pgTable("batch_inference_items", {
  id: serial("id").primaryKey(),
  batchJobId: integer("batchJobId").notNull(),
  inputReference: text("inputReference").notNull(),
  inputType: varchar("inputType", { length: 50 }).default("image").notNull(),
  status: batchItemStatusEnum("status").default("PENDING").notNull(),
  predictions: json("predictions").$type<Array<{
    label: string;
    confidence: number;
    bbox?: { x: number; y: number; width: number; height: number };
  }>>(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  topLabel: varchar("topLabel", { length: 100 }),
  processingTimeMs: integer("processingTimeMs"),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_batch_items_job").on(table.batchJobId),
  index("idx_batch_items_status").on(table.status),
]);

export type BatchInferenceItem = typeof batchInferenceItems.$inferSelect;
export type InsertBatchInferenceItem = typeof batchInferenceItems.$inferInsert;

// ============= A/B Testing =============

export const abTestExperiments = pgTable("ab_test_experiments", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelAId: integer("modelAId").notNull(),
  modelAVersion: varchar("modelAVersion", { length: 50 }),
  modelBId: integer("modelBId").notNull(),
  modelBVersion: varchar("modelBVersion", { length: 50 }),
  trafficSplitPercent: integer("trafficSplitPercent").default(50).notNull(),
  status: abTestStatusEnum("status").default("DRAFT").notNull(),
  productModelId: integer("productModelId"),
  totalInferences: integer("totalInferences").default(0).notNull(),
  modelAInferences: integer("modelAInferences").default(0).notNull(),
  modelBInferences: integer("modelBInferences").default(0).notNull(),
  modelAAccuracy: decimal("modelAAccuracy", { precision: 5, scale: 4 }),
  modelBAccuracy: decimal("modelBAccuracy", { precision: 5, scale: 4 }),
  modelAAvgLatency: decimal("modelAAvgLatency", { precision: 10, scale: 2 }),
  modelBAvgLatency: decimal("modelBAvgLatency", { precision: 10, scale: 2 }),
  winner: abTestWinnerEnum("winner"),
  statisticalSignificance: decimal("statisticalSignificance", { precision: 5, scale: 4 }),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ab_test_status").on(table.status),
  index("idx_ab_test_product").on(table.productModelId),
  index("idx_ab_test_models").on(table.modelAId, table.modelBId),
]);

export type AbTestExperiment = typeof abTestExperiments.$inferSelect;
export type InsertAbTestExperiment = typeof abTestExperiments.$inferInsert;

export const abTestResults = pgTable("ab_test_results", {
  id: serial("id").primaryKey(),
  experimentId: integer("experimentId").notNull(),
  variant: abTestVariantEnum("variant").notNull(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  inputReference: text("inputReference"),
  predictions: json("predictions").$type<Array<{
    label: string;
    confidence: number;
  }>>().notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  topLabel: varchar("topLabel", { length: 100 }),
  processingTimeMs: integer("processingTimeMs"),
  feedbackType: feedbackTypeEnum("feedbackType"),
  isCorrect: boolean("isCorrect"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ab_results_experiment").on(table.experimentId),
  index("idx_ab_results_variant").on(table.variant),
  index("idx_ab_results_created").on(table.createdAt),
]);

export type AbTestResult = typeof abTestResults.$inferSelect;
export type InsertAbTestResult = typeof abTestResults.$inferInsert;

// ============= Model Monitoring =============

export const modelPerformanceSnapshots = pgTable("model_performance_snapshots", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  totalInferences: integer("totalInferences").default(0).notNull(),
  completedInferences: integer("completedInferences").default(0).notNull(),
  failedInferences: integer("failedInferences").default(0).notNull(),
  avgLatencyMs: decimal("avgLatencyMs", { precision: 10, scale: 2 }),
  p50LatencyMs: decimal("p50LatencyMs", { precision: 10, scale: 2 }),
  p95LatencyMs: decimal("p95LatencyMs", { precision: 10, scale: 2 }),
  p99LatencyMs: decimal("p99LatencyMs", { precision: 10, scale: 2 }),
  accuracy: decimal("accuracy", { precision: 5, scale: 4 }),
  precision: decimal("precision", { precision: 5, scale: 4 }),
  recall: decimal("recall", { precision: 5, scale: 4 }),
  f1Score: decimal("f1Score", { precision: 5, scale: 4 }),
  driftScore: decimal("driftScore", { precision: 5, scale: 4 }),
  driftDetails: json("driftDetails").$type<{
    baselineDistribution: Record<string, number>;
    currentDistribution: Record<string, number>;
    psiScore: number;
    driftedFeatures: string[];
  }>(),
  confidenceDistribution: json("confidenceDistribution").$type<Record<string, number>>(),
  labelDistribution: json("labelDistribution").$type<Record<string, number>>(),
  errorRate: decimal("errorRate", { precision: 5, scale: 4 }),
  timeoutRate: decimal("timeoutRate", { precision: 5, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_perf_snapshot_model").on(table.modelId),
  index("idx_perf_snapshot_period").on(table.periodStart, table.periodEnd),
  index("idx_perf_snapshot_created").on(table.createdAt),
]);

export type ModelPerformanceSnapshot = typeof modelPerformanceSnapshots.$inferSelect;
export type InsertModelPerformanceSnapshot = typeof modelPerformanceSnapshots.$inferInsert;

export const modelDriftAlerts = pgTable("model_drift_alerts", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  alertType: driftAlertTypeEnum("alertType").notNull(),
  severity: driftSeverityEnum("severity").default("MEDIUM").notNull(),
  message: text("message").notNull(),
  details: json("details"),
  currentValue: decimal("currentValue", { precision: 10, scale: 4 }),
  baselineValue: decimal("baselineValue", { precision: 10, scale: 4 }),
  acknowledged: boolean("acknowledged").default(false).notNull(),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_drift_alert_model").on(table.modelId),
  index("idx_drift_alert_type").on(table.alertType),
  index("idx_drift_alert_severity").on(table.severity),
  index("idx_drift_alert_acknowledged").on(table.acknowledged),
]);

export type ModelDriftAlert = typeof modelDriftAlerts.$inferSelect;
export type InsertModelDriftAlert = typeof modelDriftAlerts.$inferInsert;

// ============= Training Pipeline =============

export const trainingJobs = pgTable("training_jobs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  modelId: integer("modelId").notNull(),
  targetVersion: varchar("targetVersion", { length: 50 }).notNull(),
  status: trainingJobStatusEnum("status").default("QUEUED").notNull(),
  datasetConfig: json("datasetConfig").$type<{
    datasetId?: number;
    feedbackFilter?: { minAccuracy?: number; feedbackTypes?: string[]; dateRange?: { from: string; to: string } };
    augmentation?: { flipHorizontal?: boolean; flipVertical?: boolean; rotation?: number; brightness?: number };
    trainSplit?: number;
    validationSplit?: number;
    testSplit?: number;
  }>().notNull(),
  trainingConfig: json("trainingConfig").$type<{
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    optimizer?: string;
    lossFunction?: string;
    earlyStoppingPatience?: number;
    [key: string]: unknown;
  }>(),
  progress: integer("progress").default(0).notNull(),
  currentEpoch: integer("currentEpoch").default(0),
  totalEpochs: integer("totalEpochs"),
  trainingMetrics: json("trainingMetrics").$type<{
    loss: number[];
    accuracy: number[];
    valLoss: number[];
    valAccuracy: number[];
  }>(),
  validationMetrics: json("validationMetrics").$type<{
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    confusionMatrix?: number[][];
  }>(),
  bestMetrics: json("bestMetrics").$type<{
    epoch: number;
    accuracy: number;
    loss: number;
    valAccuracy: number;
    valLoss: number;
  }>(),
  outputModelPath: text("outputModelPath"),
  outputModelKey: varchar("outputModelKey", { length: 255 }),
  // ── WS-1 (additive, nullable) ──
  datasetId: integer("datasetId"),                                // training_datasets.id
  trainingMode: varchar("trainingMode", { length: 40 }).default("local-embedding"),
  trainingDataCount: integer("trainingDataCount").default(0).notNull(),
  validationDataCount: integer("validationDataCount").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_training_jobs_model").on(table.modelId),
  index("idx_training_jobs_status").on(table.status),
  index("idx_training_jobs_created").on(table.createdAt),
]);

export type TrainingJob = typeof trainingJobs.$inferSelect;
export type InsertTrainingJob = typeof trainingJobs.$inferInsert;

export const trainingDatasets = pgTable("training_datasets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelId: integer("modelId"),
  productModelId: integer("productModelId"),
  totalSamples: integer("totalSamples").default(0).notNull(),
  labelDistribution: json("labelDistribution").$type<Record<string, number>>(),
  splitConfig: json("splitConfig").$type<{
    train: number;
    validation: number;
    test: number;
  }>(),
  sourceType: varchar("sourceType", { length: 50 }).default("feedback").notNull(),
  filterConfig: json("filterConfig").$type<{
    feedbackTypes?: string[];
    minAccuracy?: number;
    dateRange?: { from: string; to: string };
    productModelIds?: number[];
  }>(),
  storageKey: varchar("storageKey", { length: 255 }),
  fileSize: integer("fileSize"),
  status: batchJobStatusEnum("status").default("PENDING").notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_training_datasets_model").on(table.modelId),
  index("idx_training_datasets_product").on(table.productModelId),
  index("idx_training_datasets_status").on(table.status),
]);

export type TrainingDataset = typeof trainingDatasets.$inferSelect;
export type InsertTrainingDataset = typeof trainingDatasets.$inferInsert;

// ============= Edge Deployment =============

export const edgeDeployments = pgTable("edge_deployments", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  deviceId: varchar("deviceId", { length: 100 }).notNull(),
  deviceName: varchar("deviceName", { length: 255 }),
  deviceType: varchar("deviceType", { length: 100 }).default("AOI_MACHINE").notNull(),
  machineId: integer("machineId"),
  packageUrl: text("packageUrl"),
  packageKey: varchar("packageKey", { length: 255 }),
  packageSize: integer("packageSize"),
  packageHash: varchar("packageHash", { length: 128 }),
  // ── WS-2 (additive, nullable) — packaging version + deploy/activate audit ──
  packageVersion: varchar("packageVersion", { length: 50 }),
  status: edgeDeployStatusEnum("status").default("PENDING").notNull(),
  deployConfig: json("deployConfig").$type<{
    quantization?: "fp32" | "fp16" | "int8";
    runtime?: "ONNX" | "TENSORRT" | "OPENVINO";
    maxBatchSize?: number;
    optimizationLevel?: "basic" | "extended" | "full";
    // ── W7-D (doc 27 gap V19) — delivery verification, additive (NO DDL):
    // stamped by confirmDeployment when the device-reported sha256 matches
    // packageHash. Absent on legacy rows / unverified status reports.
    deployVerifiedAt?: string;
    verifiedHash?: string;
    // used by rollbackDevice (previously an untyped cast)
    previousDeploymentId?: number;
  }>(),
  lastSyncAt: timestamp("lastSyncAt"),
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
  deployedAt: timestamp("deployedAt"),
  activatedAt: timestamp("activatedAt"),
  offlineResultsPending: integer("offlineResultsPending").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_edge_deploy_model").on(table.modelId),
  index("idx_edge_deploy_device").on(table.deviceId),
  index("idx_edge_deploy_machine").on(table.machineId),
  index("idx_edge_deploy_status").on(table.status),
]);

export type EdgeDeployment = typeof edgeDeployments.$inferSelect;
export type InsertEdgeDeployment = typeof edgeDeployments.$inferInsert;

export const edgeInferenceSync = pgTable("edge_inference_sync", {
  id: serial("id").primaryKey(),
  deploymentId: integer("deploymentId").notNull(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  inputReference: text("inputReference"),
  predictions: json("predictions").$type<Array<{
    label: string;
    confidence: number;
  }>>().notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  topLabel: varchar("topLabel", { length: 100 }),
  processingTimeMs: integer("processingTimeMs"),
  inferredAt: timestamp("inferredAt").notNull(),
  deviceId: varchar("deviceId", { length: 100 }).notNull(),
  synced: boolean("synced").default(false).notNull(),
  syncedAt: timestamp("syncedAt"),
  inspectionId: integer("inspectionId"),
  measurementResultId: integer("measurementResultId"),
  // ── WS-2 (additive, nullable) — client-supplied id for idempotent sync ──
  localResultId: varchar("localResultId", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_edge_sync_deployment").on(table.deploymentId),
  index("idx_edge_sync_device").on(table.deviceId),
  index("idx_edge_sync_synced").on(table.synced),
  index("idx_edge_sync_inferred").on(table.inferredAt),
  // Idempotent offline sync: at most one row per (deployment, localResultId).
  // Partial (localResultId NOT NULL) so legacy rows without an id are not blocked.
  uniqueIndex("uq_edge_sync_deployment_localresult")
    .on(table.deploymentId, table.localResultId)
    .where(sql`"localResultId" IS NOT NULL`),
]);

export type EdgeInferenceSync = typeof edgeInferenceSync.$inferSelect;
export type InsertEdgeInferenceSync = typeof edgeInferenceSync.$inferInsert;

// ============= AI Quality Gate Config =============

export const aiQualityGateConfigs = pgTable("ai_quality_gate_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  modelId: integer("modelId").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  autoOkThreshold: decimal("autoOkThreshold", { precision: 5, scale: 4 }).default("0.95").notNull(),
  autoNgThreshold: decimal("autoNgThreshold", { precision: 5, scale: 4 }).default("0.85").notNull(),
  reviewThreshold: decimal("reviewThreshold", { precision: 5, scale: 4 }).default("0.60").notNull(),
  ngLabels: json("ngLabels").$type<string[]>().default([]).notNull(),
  okLabels: json("okLabels").$type<string[]>().default([]).notNull(),
  ensembleConfigId: integer("ensembleConfigId"),
  // B6 — A/B canary live: when set + experiment RUNNING, processQualityGate runs the
  // canary path (variant inference + abTestResults logging). NULL ⇒ legacy behaviour.
  activeExperimentId: integer("activeExperimentId"),
  alertOnAutoNg: boolean("alertOnAutoNg").default(true).notNull(),
  metadata: json("metadata"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_qg_config_machine").on(table.machineId),
  index("idx_qg_config_product").on(table.productModelId),
  index("idx_qg_config_model").on(table.modelId),
  index("idx_qg_config_enabled").on(table.enabled),
]);

export type AiQualityGateConfig = typeof aiQualityGateConfigs.$inferSelect;
export type InsertAiQualityGateConfig = typeof aiQualityGateConfigs.$inferInsert;

// ============= AI Ensemble Config =============

export const aiEnsembleConfigs = pgTable("ai_ensemble_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  strategy: ensembleStrategyEnum("strategy").default("VOTING").notNull(),
  modelIds: json("modelIds").$type<number[]>().notNull(),
  weights: json("weights").$type<number[]>(),
  productModelId: integer("productModelId"),
  cascadeThreshold: decimal("cascadeThreshold", { precision: 5, scale: 4 }),
  enabled: boolean("enabled").default(true).notNull(),
  metadata: json("metadata"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ensemble_config_product").on(table.productModelId),
  index("idx_ensemble_config_enabled").on(table.enabled),
]);

export type AiEnsembleConfig = typeof aiEnsembleConfigs.$inferSelect;
export type InsertAiEnsembleConfig = typeof aiEnsembleConfigs.$inferInsert;

// ============= AI Quality Gate Results =============

export const aiQualityGateResults = pgTable("ai_quality_gate_results", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId").notNull(),
  configId: integer("configId").notNull(),
  decision: aiDecisionEnum("decision").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  topLabel: varchar("topLabel", { length: 100 }),
  predictions: json("predictions").$type<Array<{ label: string; confidence: number }>>(),
  ensembleResults: json("ensembleResults").$type<Array<{
    modelId: number;
    modelCode: string;
    topLabel: string;
    confidence: number;
    predictions: Array<{ label: string; confidence: number }>;
  }>>(),
  processingTimeMs: integer("processingTimeMs"),
  reviewedBy: integer("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  reviewDecision: varchar("reviewDecision", { length: 20 }),
  reviewNotes: text("reviewNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_qg_result_inspection").on(table.inspectionId),
  index("idx_qg_result_config").on(table.configId),
  index("idx_qg_result_decision").on(table.decision),
  index("idx_qg_result_created").on(table.createdAt),
]);

export type AiQualityGateResult = typeof aiQualityGateResults.$inferSelect;
export type InsertAiQualityGateResult = typeof aiQualityGateResults.$inferInsert;

// ============= B2 — AI Calibration Reports (ECE / reliability diagram) =============

/**
 * AI Calibration Reports — stores Expected Calibration Error (ECE), Maximum
 * Calibration Error (MCE), Brier score, an optionally-fitted temperature, and the
 * per-bin reliability diagram for a model over a labelled period. Labels come from
 * human review (aiQualityGateResults.reviewDecision). Read-only / append; no inference
 * behaviour is changed by writing here.
 */
export const aiCalibrationReports = pgTable("ai_calibration_reports", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  modelVersion: varchar("modelVersion", { length: 50 }),
  // Optional scope filters
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  // Labelled period analysed
  periodStart: timestamp("periodStart").notNull(),
  periodEnd: timestamp("periodEnd").notNull(),
  // Sample size used (reviewed results in period/scope)
  sampleCount: integer("sampleCount").default(0).notNull(),
  // Calibration metrics (precision 6 to capture small ECE values)
  ece: decimal("ece", { precision: 7, scale: 6 }),
  mce: decimal("mce", { precision: 7, scale: 6 }),
  brierScore: decimal("brierScore", { precision: 7, scale: 6 }),
  // Optional fitted temperature (1-D NLL min) + ECE recomputed after scaling
  temperature: decimal("temperature", { precision: 8, scale: 4 }),
  eceAfterTemp: decimal("eceAfterTemp", { precision: 7, scale: 6 }),
  numBins: integer("numBins").default(10).notNull(),
  // Reliability diagram bins
  reliabilityBins: json("reliabilityBins").$type<Array<{
    binLower: number;
    binUpper: number;
    avgConfidence: number;
    accuracy: number;
    count: number;
  }>>().notNull(),
  metadata: json("metadata"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_calibration_model").on(table.modelId),
  index("idx_ai_calibration_period").on(table.periodStart, table.periodEnd),
  index("idx_ai_calibration_created").on(table.createdAt),
]);

export type AiCalibrationReport = typeof aiCalibrationReports.$inferSelect;
export type InsertAiCalibrationReport = typeof aiCalibrationReports.$inferInsert;

// ============= AI Image Embeddings (pgvector) =============

export const aiImageEmbeddings = pgTable("ai_image_embeddings", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId"),
  measurementResultId: integer("measurementResultId"),
  imageUrl: text("imageUrl").notNull(),
  embedding: text("embedding").notNull(), // stored as text "[0.1,0.2,...]", cast to vector in SQL (raw/back-compat)
  // pgvector(1024) — WS-3. Nullable: chỉ điền cho dòng 1024-dim (mxbai-embed-large, L2-normalized).
  // Index HNSW (idx_image_emb_vec_hnsw, vector_cosine_ops) giữ thủ công trong
  // drizzle/0091_image_embeddings_pgvector.sql (drizzle-kit không sinh được hnsw).
  embeddingVec: pgvector(1024)("embedding_vec"),
  embeddingDim: integer("embeddingDim").notNull(),
  modelCode: varchar("modelCode", { length: 100 }).notNull(),
  label: varchar("label", { length: 255 }),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  defectType: varchar("defectType", { length: 255 }),
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_image_emb_inspection").on(table.inspectionId),
  index("idx_image_emb_measurement").on(table.measurementResultId),
  index("idx_image_emb_model").on(table.modelCode),
  index("idx_image_emb_machine").on(table.machineId),
  index("idx_image_emb_product").on(table.productModelId),
  index("idx_image_emb_label").on(table.label),
  index("idx_image_emb_created").on(table.createdAt),
]);

export type AiImageEmbedding = typeof aiImageEmbeddings.$inferSelect;
export type InsertAiImageEmbedding = typeof aiImageEmbeddings.$inferInsert;

// ============= Active Learning Label Queue =============
export const aiLabelQueue = pgTable("ai_label_queue", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspectionId"),
  measurementResultId: integer("measurementResultId"),
  imageUrl: text("imageUrl").notNull(),
  // AI prediction
  modelId: integer("modelId").notNull(),
  predictedLabel: varchar("predictedLabel", { length: 100 }),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  predictions: json("predictions").$type<Array<{ label: string; confidence: number }>>(),
  uncertainty: decimal("uncertainty", { precision: 5, scale: 4 }),
  // Ensemble disagreement (for committee sampling)
  ensembleDisagreement: decimal("ensembleDisagreement", { precision: 5, scale: 4 }),
  ensemblePredictions: json("ensemblePredictions").$type<Array<{ modelId: number; label: string; confidence: number }>>(),
  // Active learning metadata
  samplingStrategy: samplingStrategyEnum("samplingStrategy").default("UNCERTAINTY").notNull(),
  priority: integer("priority").default(0).notNull(),
  status: labelQueueStatusEnum("status").default("PENDING").notNull(),
  // Human review
  assignedTo: integer("assignedTo"),
  reviewedBy: integer("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  humanLabel: varchar("humanLabel", { length: 100 }),
  reviewNotes: text("reviewNotes"),
  // Context
  machineId: integer("machineId"),
  productModelId: integer("productModelId"),
  defectType: varchar("defectType", { length: 100 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_label_queue_status").on(table.status),
  index("idx_label_queue_model").on(table.modelId),
  index("idx_label_queue_priority").on(table.priority),
  index("idx_label_queue_machine").on(table.machineId),
  index("idx_label_queue_product").on(table.productModelId),
  index("idx_label_queue_assigned").on(table.assignedTo),
  index("idx_label_queue_created").on(table.createdAt),
  index("idx_label_queue_confidence").on(table.confidence),
]);

export type AiLabelQueue = typeof aiLabelQueue.$inferSelect;
export type InsertAiLabelQueue = typeof aiLabelQueue.$inferInsert;

// ============= AI Chat Conversations =============
export const aiChatConversations = pgTable("ai_chat_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 255 }),
  context: json("context"),
  messageCount: integer("messageCount").default(0).notNull(),
  lastMessageAt: timestamp("lastMessageAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_chat_conv_user").on(table.userId),
  index("idx_chat_conv_updated").on(table.updatedAt),
]);

export type AiChatConversation = typeof aiChatConversations.$inferSelect;
export type InsertAiChatConversation = typeof aiChatConversations.$inferInsert;

// ============= AI Chat Messages =============
export const aiChatMessages = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversationId").notNull(),
  role: chatRoleEnum("role").notNull(),
  content: text("content"),
  toolCalls: json("toolCalls"),
  toolResults: json("toolResults"),
  tokensUsed: integer("tokensUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_chat_msg_conversation").on(table.conversationId),
  index("idx_chat_msg_role").on(table.role),
  index("idx_chat_msg_created").on(table.createdAt),
]);

export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessages.$inferInsert;

// ============= AI API Keys =============
export const aiApiKeys = pgTable("ai_api_keys", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  provider: apiKeyProviderEnum("provider").notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  endpoint: text("endpoint"),
  status: apiKeyStatusEnum("status").default("active").notNull(),
  lastTestedAt: timestamp("lastTestedAt"),
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_api_keys_provider").on(table.provider),
  index("idx_ai_api_keys_status").on(table.status),
  index("idx_ai_api_keys_created_by").on(table.createdBy),
]);

export type AiApiKey = typeof aiApiKeys.$inferSelect;
export type InsertAiApiKey = typeof aiApiKeys.$inferInsert;

// ============= AI System Config =============
export const aiSystemConfig = pgTable("ai_system_config", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: integer("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AiSystemConfig = typeof aiSystemConfig.$inferSelect;
export type InsertAiSystemConfig = typeof aiSystemConfig.$inferInsert;

// ============= AI Specialist Agent Sessions =============
export const aiSpecialistSessions = pgTable("ai_specialist_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  sessionType: varchar("sessionType", { length: 30 }).default("single").notNull(),
  moduleName: varchar("moduleName", { length: 255 }),
  objective: text("objective").notNull(),
  requestedAgents: json("requestedAgents").$type<string[]>(),
  language: varchar("language", { length: 10 }).default("vi").notNull(),
  status: varchar("status", { length: 30 }).default("running").notNull(),
  summary: text("summary"),
  aggregateOutput: json("aggregateOutput"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_specialist_sessions_user").on(table.userId),
  index("idx_ai_specialist_sessions_module").on(table.moduleName),
  index("idx_ai_specialist_sessions_status").on(table.status),
  index("idx_ai_specialist_sessions_created").on(table.createdAt),
]);

export type AiSpecialistSession = typeof aiSpecialistSessions.$inferSelect;
export type InsertAiSpecialistSession = typeof aiSpecialistSessions.$inferInsert;

export const aiSpecialistSessionSteps = pgTable("ai_specialist_session_steps", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  stepOrder: integer("stepOrder").notNull(),
  agentId: varchar("agentId", { length: 60 }).notNull(),
  status: varchar("status", { length: 30 }).default("completed").notNull(),
  inputPayload: json("inputPayload"),
  outputPayload: json("outputPayload"),
  modelId: varchar("modelId", { length: 255 }),
  tokensPrompt: integer("tokensPrompt"),
  tokensGenerated: integer("tokensGenerated"),
  totalTimeMs: integer("totalTimeMs"),
  tokensPerSecond: decimal("tokensPerSecond", { precision: 10, scale: 2 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_specialist_steps_session").on(table.sessionId),
  index("idx_ai_specialist_steps_agent").on(table.agentId),
  index("idx_ai_specialist_steps_status").on(table.status),
  index("idx_ai_specialist_steps_created").on(table.createdAt),
]);

export type AiSpecialistSessionStep = typeof aiSpecialistSessionSteps.$inferSelect;
export type InsertAiSpecialistSessionStep = typeof aiSpecialistSessionSteps.$inferInsert;

/** Wave 1 — chấm tay mức hữu ích của một phiên specialist (1 người 1 phiếu/phiên). */
export const aiSpecialistFeedback = pgTable("ai_specialist_feedback", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  userId: integer("userId").notNull(),
  agentId: varchar("agentId", { length: 64 }).notNull(),
  moduleName: varchar("moduleName", { length: 255 }),
  rating: varchar("rating", { length: 16 }).notNull(),
  usefulSections: json("usefulSections").$type<string[]>(),
  reason: text("reason"),
  repoContextUsed: boolean("repoContextUsed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_ai_specialist_feedback_session_user").on(table.sessionId, table.userId),
  index("idx_ai_specialist_feedback_agent").on(table.agentId),
  index("idx_ai_specialist_feedback_module").on(table.moduleName),
]);

export type AiSpecialistFeedback = typeof aiSpecialistFeedback.$inferSelect;
export type InsertAiSpecialistFeedback = typeof aiSpecialistFeedback.$inferInsert;

// ============= B3 — Unsupervised Anomaly Detection (PatchCore-style) =============
//
// Memory bank chứa embedding ảnh OK (coreset subsample) theo scope
// (productModelId, machineId, modelCode). Scoring = kNN distance tới bank;
// anomaly khi distance vượt threshold = percentile (p99) phân bố khoảng cách OK.
//
// Cột embedding_vec vector(1024) + HNSW giữ THỦ CÔNG trong migration
// drizzle/0109_ai_anomaly.sql (bọc EXCEPTION) — degrade brute-force JS khi thiếu
// pgvector. Cột embedding TEXT là nguồn raw/back-compat (luôn có).

export const aiAnomalyMemoryBank = pgTable("ai_anomaly_memory_bank", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  modelCode: varchar("modelCode", { length: 120 }).notNull(),
  // Raw embedding "[v1,v2,...]" — luôn có (back-compat, brute-force JS).
  embedding: text("embedding").notNull(),
  // pgvector(1024) — chỉ điền cho dòng 1024-dim. Nullable. HNSW trong migration.
  embeddingVec: pgvector(1024)("embedding_vec"),
  embeddingDim: integer("embeddingDim").notNull(),
  // "onnx" | "text-of-image" | "heuristic" — nguồn embedding (degrade trung thực).
  source: varchar("source", { length: 32 }).notNull(),
  imageUrl: text("imageUrl"),
  // ── U6-a (0156, additive, nullable) — tenant scope + inert RLS (G-9). NULL =
  // unscoped (allow-all under the inert app_tenant_allows policy). ──
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_anomaly_bank_scope").on(table.productModelId, table.machineId, table.modelCode),
  index("idx_anomaly_bank_product").on(table.productModelId),
  index("idx_anomaly_bank_machine").on(table.machineId),
  index("idx_anomaly_bank_created").on(table.createdAt),
]);

export type AiAnomalyMemoryBankRow = typeof aiAnomalyMemoryBank.$inferSelect;
export type InsertAiAnomalyMemoryBankRow = typeof aiAnomalyMemoryBank.$inferInsert;

export const aiAnomalyProfiles = pgTable("ai_anomaly_profiles", {
  id: serial("id").primaryKey(),
  productModelId: integer("productModelId"),
  machineId: integer("machineId"),
  modelCode: varchar("modelCode", { length: 120 }).notNull(),
  // Ngưỡng anomaly = quantile(distances, p99) tính khi build bank.
  threshold: decimal("threshold", { precision: 12, scale: 8 }).notNull(),
  // k cho kNN scoring.
  k: integer("k").default(5).notNull(),
  // Thống kê phân bố khoảng cách nội bộ (min/mean/p50/p90/p99/max...).
  distStats: json("distStats").$type<{
    count: number;
    min: number;
    mean: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
  }>(),
  bankSize: integer("bankSize").default(0).notNull(),
  // Nguồn embedding chủ đạo dùng khi build (cờ degrade trung thực).
  source: varchar("source", { length: 32 }).notNull(),
  degraded: boolean("degraded").default(false).notNull(),
  // ── U6-a (0156, additive, nullable) — tenant scope + inert RLS (G-9). ──
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  // ── F3/D2 (doc69 G9, migration 0300, additive, nullable, NOT YET APPLIED) ──
  // ROC-calibrated threshold (ai/aiAnomalyCalibration.calibrateThreshold), swept
  // to hit a target recall/FPR over labelled NG/OK scores. When set, the scorer
  // (aiAnomalyDetection.scoreFromVector) uses THIS instead of `threshold` (the
  // fixed p99 self-distance). null = uncalibrated → unchanged p99 behaviour.
  // NOTE: server/db/aiAnomaly.ts getProfile()/getBankStats() guard their
  // full-row SELECT against this column being absent pre-migration (42703
  // undefined_column → fall back to a legacy column list) — do NOT add a
  // .select() of this table elsewhere without the same guard.
  calibratedThreshold: decimal("calibratedThreshold", { precision: 12, scale: 8 }),
  calibrationTarget: json("calibrationTarget").$type<{
    targetRecall?: number;
    targetFpr?: number;
    achievedRecall: number;
    achievedFpr: number;
    sampleCount: { ng: number; ok: number };
    calibratedAt: string;
  }>(),
  builtAt: timestamp("builtAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_anomaly_profile_scope").on(table.productModelId, table.machineId, table.modelCode),
  index("idx_anomaly_profile_product").on(table.productModelId),
  index("idx_anomaly_profile_machine").on(table.machineId),
]);

export type AiAnomalyProfile = typeof aiAnomalyProfiles.$inferSelect;
export type InsertAiAnomalyProfile = typeof aiAnomalyProfiles.$inferInsert;

// ============= B7 — Defect Segmentation + Sub-pixel Metrology =============

/**
 * Defect Segmentations — mask vùng defect (do QC vẽ tay HOẶC model segmentation
 * sinh ra) + số đo metrology (area/perimeter/Feret/equivDia).
 *
 * Additive, mọi cột scope nullable. maskData lưu polygon points (gọn) hoặc RLE.
 * Đơn vị: lưu sẵn cả pixel (...Px) và vật lý (...) — nếu thiếu calibration thì
 * cột vật lý = pixel và umPerPx NULL, areaUnit/lengthUnit = "px" (degrade trung thực).
 */
export const defectSegmentations = pgTable("defect_segmentations", {
  id: serial("id").primaryKey(),
  // Liên kết (nullable — mask QC có thể chưa gắn measurement).
  measurementResultId: integer("measurementResultId"),
  inspectionId: integer("inspectionId"),
  imageUrl: text("imageUrl"),
  // Model sinh mask (NULL nếu nguồn "human").
  modelId: integer("modelId"),
  modelVersion: varchar("modelVersion", { length: 50 }),
  // "human" (QC vẽ) | "model" (segmentation engine).
  source: varchar("source", { length: 16 }).notNull(),
  // "polygon" | "rle".
  maskFormat: varchar("maskFormat", { length: 16 }).default("polygon").notNull(),
  // Polygon: { width, height, points:[{x,y}...] } | RLE: { width, height, counts:[] }.
  maskData: json("maskData").$type<{
    width: number;
    height: number;
    points?: Array<{ x: number; y: number }>;
    counts?: number[];
  }>().notNull(),
  classLabel: varchar("classLabel", { length: 120 }).notNull(),
  defectCatalogId: integer("defectCatalogId"),
  confidence: decimal("confidence", { precision: 6, scale: 4 }),
  // ── Metrology pixel-space (luôn có) ──
  areaPx: decimal("areaPx", { precision: 16, scale: 4 }),
  perimeterPx: decimal("perimeterPx", { precision: 16, scale: 4 }),
  feretMaxPx: decimal("feretMaxPx", { precision: 16, scale: 4 }),
  feretMinPx: decimal("feretMinPx", { precision: 16, scale: 4 }),
  equivDiaPx: decimal("equivDiaPx", { precision: 16, scale: 4 }),
  // ── Metrology vật lý (NULL khi thiếu calibration) ──
  umPerPx: decimal("umPerPx", { precision: 16, scale: 8 }),
  areaUnit: varchar("areaUnit", { length: 8 }),   // "px" | "um"
  lengthUnit: varchar("lengthUnit", { length: 8 }), // "px" | "um"
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_defect_seg_measurement").on(table.measurementResultId),
  index("idx_defect_seg_inspection").on(table.inspectionId),
  index("idx_defect_seg_model").on(table.modelId),
  index("idx_defect_seg_source").on(table.source),
  index("idx_defect_seg_created").on(table.createdAt),
]);

export type DefectSegmentation = typeof defectSegmentations.$inferSelect;
export type InsertDefectSegmentation = typeof defectSegmentations.$inferInsert;

// ============= GĐ2 — AI Copilot Pending Actions (HITL write-action store) =============
//
// Server-side store for write-actions proposed by the AI Copilot. A write tool
// NEVER mutates the DB at propose time — it records a `proposed` row here with a
// dry-run preview, then waits for an explicit user confirm (copilot.confirmAction)
// that re-checks RBAC and runs execute() with args read from THIS row (never the
// client). TTL (expiresAt) + token (uuid bound to userId) + idempotencyKey unique
// guard against replay / double-execute. Migration: drizzle/0114_ai_pending_actions.sql.
export const aiPendingActions = pgTable("ai_pending_actions", {
  // uuid primary key doubles as the confirm token (bound to userId).
  id: varchar("id", { length: 64 }).primaryKey(),
  tool: varchar("tool", { length: 100 }).notNull(),
  // Server-chosen args (the ONLY source of truth at execute time).
  argsJson: json("argsJson").$type<Record<string, unknown>>().notNull(),
  userId: integer("userId").notNull(),
  userRole: varchar("userRole", { length: 50 }).notNull(),
  requiredPermissionJson: json("requiredPermissionJson").$type<{ module: string; action: string }>(),
  summary: text("summary").notNull(),
  previewJson: json("previewJson").$type<Record<string, unknown>>(),
  status: aiPendingActionStatusEnum("status").default("proposed").notNull(),
  // Idempotency: at most one execution per logical action.
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  executedAt: timestamp("executedAt"),
  resultJson: json("resultJson").$type<Record<string, unknown>>(),
}, (table) => [
  index("idx_ai_pending_actions_user").on(table.userId),
  index("idx_ai_pending_actions_status").on(table.status),
  index("idx_ai_pending_actions_expires").on(table.expiresAt),
]);

export type AiPendingAction = typeof aiPendingActions.$inferSelect;
export type InsertAiPendingAction = typeof aiPendingActions.$inferInsert;

// ============= GĐ3b — AI Copilot Agent Sessions (multi-step orchestrator) =============
//
// Server-side state for a multi-step agentic plan. The orchestrator STANDS ON TOP
// of the HITL write flow: it only ever calls proposeAction (write step) +
// confirmAction (core, user-triggered via tRPC). It NEVER executes a tool directly
// and NEVER auto-confirms. advance() STOPS at every write step (status
// awaiting_confirm); the cursor only moves past a write after the user confirms it
// (confirmStep → core confirmAction). Migration: drizzle/0017_ai_agent_sessions.sql.

/**
 * Deterministic, minimal condition a `branch` step evaluates against the
 * observations gathered so far (read-step results only — no LLM at eval time).
 * `when.path` is resolved against the payload of the most recent DONE read-step
 * observation (or the most recent one whose `tool` matches `observationTool`,
 * when given) using dotted-path lookup (e.g. "data.count"). `thenGoto`/
 * `elseGoto` are step INDICES the orchestrator jumps the cursor to — both MUST
 * be forward-only (> the branch step's own index); the orchestrator re-checks
 * this at eval time and fails safe (fall-through) on any violation. Omitting
 * `thenGoto`/`elseGoto` means "fall through" for that outcome — identical to
 * today's no-condition skip behavior.
 */
export interface AgentBranchCondition {
  when: {
    /** Dotted path into the observation payload, e.g. "data.count". Empty/"" = the whole payload. */
    path: string;
    op: "eq" | "neq" | "gt" | "lt" | "exists" | "contains";
    /** Comparison value (unused by "exists"). */
    value?: unknown;
    /** Restrict which read step's payload to inspect by tool name (default: most recent read observation). */
    observationTool?: string;
  };
  /** Step index to jump to when the condition is true. Omitted = fall through. */
  thenGoto?: number;
  /** Step index to jump to when the condition is false. Omitted = fall through. */
  elseGoto?: number;
}

/** A single planned step produced by the planner (validated against the registry). */
export interface AgentPlanStep {
  /** read = run immediately; write = HITL propose+confirm; guidance/navigate/prefill = client directive; branch = conditional cursor jump. */
  kind: "read" | "write" | "guidance" | "navigate" | "prefill" | "branch";
  /** Registered tool name (null for guidance/branch which carry no tool). */
  tool?: string | null;
  /** Args validated against tool.parameters at plan time. */
  args?: Record<string, unknown>;
  /** Short human-readable reason this step exists. */
  rationale?: string;
  /** `branch` steps only. Absent = today's unconditional skip/fall-through behavior. */
  condition?: AgentBranchCondition;
}

export interface AgentPlan {
  steps: AgentPlanStep[];
  /** Optional planner-emitted summary of the overall approach. */
  summary?: string;
}

/** Outcome of a single executed/handled step (appended to stepResults in order). */
export interface AgentStepResult {
  /**
   * `index >= 0` — the step's real position in `plan.steps` at the time it ran.
   * `index < 0` — a SYNTHETIC audit-only entry (e.g. the observe→replan
   * "REPLANNED" note, sentinel `-1 - cursor`), never a real plan step. Any
   * consumer computing progress/step-count (server or client) MUST filter
   * `index < 0` entries out first — otherwise a synthetic note can inflate
   * `completed` past `plan.steps.length` (e.g. after a replan truncates the
   * tail) and render >100% progress.
   */
  index: number;
  kind: AgentPlanStep["kind"];
  tool?: string | null;
  status: "done" | "awaiting_confirm" | "skipped" | "failed";
  /** Linked ai_pending_actions id for a write step. */
  actionId?: string | null;
  /** Compact result/payload (tool result, client directive, or error message). */
  payload?: unknown;
  message?: string;
}

export const aiAgentSessions = pgTable("ai_agent_sessions", {
  // uuid primary key (session id).
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: integer("userId").notNull(),
  userRole: varchar("userRole", { length: 50 }).notNull(),
  goal: text("goal").notNull(),
  planJson: json("planJson").$type<AgentPlan>(),
  cursor: integer("cursor").default(0).notNull(),
  status: agentSessionStatusEnum("status").default("planning").notNull(),
  stepResults: json("stepResults").$type<AgentStepResult[]>().default([]).notNull(),
  linkedActionIds: json("linkedActionIds").$type<string[]>().default([]).notNull(),
  writeCount: integer("writeCount").default(0).notNull(),
  /**
   * Wave 3 / D1 — observe→replan budget counter (migration 0302, NOT applied by
   * this task; owner `aoi` runs it — see brief). Nullable/additive: reads treat
   * a missing value (column not yet migrated, or a pre-migration row) as 0 via
   * `?? 0`; `aiAgentOrchestrator` also falls back to an explicit legacy column
   * list on 42703 (undefined_column) so session loading never breaks before the
   * migration runs. Survives a process restart because it lives on the session row.
   */
  replanCount: integer("replanCount").default(0),
  playbookId: varchar("playbookId", { length: 120 }),
  lang: varchar("lang", { length: 5 }).default("vi").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_agent_sessions_user").on(table.userId),
  index("idx_ai_agent_sessions_status").on(table.status),
  index("idx_ai_agent_sessions_expires").on(table.expiresAt),
]);

export type AiAgentSession = typeof aiAgentSessions.$inferSelect;
export type InsertAiAgentSession = typeof aiAgentSessions.$inferInsert;

// ============= AI Gateway Metrics (P4 — doc 12 §9) =============
// One row per inference routed through the AI Gateway (server/services/aiGateway.ts).
// Persists what was previously an in-memory routerStats counter (lost on restart):
// tier distribution, tokens in/out, latency, model, A/B variant, and outcome. Written
// async/batched off the hot path; the gateway dashboards read aggregates from here.
export const aiGatewayMetrics = pgTable("ai_gateway_metrics", {
  id: serial("id").primaryKey(),
  // Cognitive-ladder tier (0–4) the request was routed to.
  tier: integer("tier").notNull(),
  // Logical task kind (chat/intent/extract/rca/report/vision/embed).
  task: varchar("task", { length: 32 }).notNull(),
  // Resolved GGUF model basename (or "default" when the engine default was used).
  model: varchar("model", { length: 160 }).notNull().default("default"),
  // A/B experiment variant when an A/B split flag was active ("A"/"B"), else null.
  abVariant: varchar("abVariant", { length: 1 }),
  // Token accounting — prompt (in) and generated (out).
  tokensIn: integer("tokensIn").default(0).notNull(),
  tokensOut: integer("tokensOut").default(0).notNull(),
  // Wall-clock latency of the inference in milliseconds.
  latencyMs: integer("latencyMs").default(0).notNull(),
  // Outcome: ok | error | rate_limited.
  outcome: varchar("outcome", { length: 16 }).default("ok").notNull(),
  // Whether a fast (3B/4B) tier model was configured at decision time.
  fastModelConfigured: boolean("fastModelConfigured").default(false).notNull(),
  // Who triggered it (best-effort; null for system/cron callers).
  userId: integer("userId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_gateway_metrics_created").on(table.createdAt),
  index("idx_ai_gateway_metrics_tier").on(table.tier),
  index("idx_ai_gateway_metrics_model").on(table.model),
]);

export type AiGatewayMetric = typeof aiGatewayMetrics.$inferSelect;
export type InsertAiGatewayMetric = typeof aiGatewayMetrics.$inferInsert;

// ============= AI Gateway Quota (doc69 G2-4) =============
// Per-user/role DAILY (rolling 24h) token budget, enforced by aiGateway.planInference when
// AI_QUOTA_ENFORCE is on (default OFF). Usage itself is read from ai_gateway_metrics above —
// this table only stores the budget. See drizzle/0298_ai_gateway_quota.sql for the exact DDL
// (incl. the two partial-unique indexes this schema definition documents but does not encode
// — drizzle-kit push is not the deploy path here; the hand-authored migration is authoritative).
export const aiGatewayQuota = pgTable("ai_gateway_quota", {
  id: serial("id").primaryKey(),
  // Scope: userId set → per-user row (highest priority). userId null + role set → per-role
  // default. Both null → deployment-wide default. See 0298's partial unique indexes for the
  // "at most one ENABLED row per scope" constraint (not expressible in this generic index()).
  userId: integer("userId"),
  role: varchar("role", { length: 32 }),
  dailyTokenBudget: integer("dailyTokenBudget").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  notes: text("notes"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_gateway_quota_user").on(table.userId),
  index("idx_ai_gateway_quota_role").on(table.role),
  index("idx_ai_gateway_quota_created").on(table.createdAt),
]);

export type AiGatewayQuota = typeof aiGatewayQuota.$inferSelect;
export type InsertAiGatewayQuota = typeof aiGatewayQuota.$inferInsert;

// ============= AI LLM Audit (doc69 G2-5a, Wave 1 W1-4a) =============
// Privacy-safe audit trail for HIGH-RISK AI-influenced decisions (rca / report / vision — see
// server/services/aiGateway.ts's HIGH_RISK_TASKS + server/services/ai/aiLlmAudit.ts). Stores
// sha256 HASHES of the already-REDACTED prompt/response (never raw text) so an operator can
// PROVE "this exact (redacted) prompt produced this exact (redacted) response" for a
// quality-affecting decision, without ever persisting anything sensitive — no secret enters a
// hash preimage because aiSafety's redaction runs BEFORE hashing. Gated by
// AI_LLM_AUDIT_ENABLED (default ON — see the flag's doc comment in aiGateway.ts). Migration:
// drizzle/0299_ai_llm_audit.sql (additive, CREATE TABLE IF NOT EXISTS, DDL by owner `aoi` —
// UNAPPLIED until an operator runs it; the audit path no-ops fail-safe until then).
interface AiLlmAuditSafetyFlags {
  scope: "input" | "output";
  risk: "none" | "low" | "high";
  matched: string[];
  redactedCount: number;
  redactionTypes: string[];
}

export const aiLlmAudit = pgTable("ai_llm_audit", {
  id: serial("id").primaryKey(),
  // Who triggered it (best-effort; null for system/cron callers).
  userId: integer("userId"),
  // Logical task kind — only the HIGH-RISK subset of TaskKind is ever audited (rca/report/
  // vision), never chat/intent/extract/embed/code/fim (volume — see aiGateway.ts).
  task: varchar("task", { length: 32 }).notNull(),
  // Cognitive-ladder tier (0–4) the request was routed to.
  tier: integer("tier").notNull(),
  // Resolved GGUF model basename (or "default" when the engine default was used).
  model: varchar("model", { length: 160 }).notNull().default("default"),
  // ok | error | blocked. (rate_limited/quota_exceeded/license_denied never reach a model —
  // there is nothing to audit for those, they are pure gateway-policy rejections.)
  outcome: varchar("outcome", { length: 16 }).notNull(),
  // sha256(hex) of the already-REDACTED prompt text (GatewayPlan.safeText).
  promptSha256: varchar("promptSha256", { length: 64 }).notNull(),
  // sha256(hex) of the already-OUTPUT-REDACTED response text, or null (error/blocked calls —
  // and calls whose caller did not supply a response text — may have none).
  responseSha256: varchar("responseSha256", { length: 64 }),
  promptChars: integer("promptChars").default(0).notNull(),
  responseChars: integer("responseChars").default(0).notNull(),
  latencyMs: integer("latencyMs").default(0).notNull(),
  // Compact G2-2 safety summary (injection risk + redaction counts) — no raw text.
  safetyFlagsJson: json("safetyFlagsJson").$type<AiLlmAuditSafetyFlags | null>(),
  // doc44 W6-4 correlation id (server/services/observability/correlation.ts), when available.
  correlationId: varchar("correlationId", { length: 128 }),
  // Left NULL by default — a future opt-in could store a redacted excerpt; not populated now.
  redactedSnippet: text("redactedSnippet"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_llm_audit_created").on(table.createdAt),
  index("idx_ai_llm_audit_user").on(table.userId),
  index("idx_ai_llm_audit_task").on(table.task),
]);

export type AiLlmAuditRow = typeof aiLlmAudit.$inferSelect;
export type InsertAiLlmAudit = typeof aiLlmAudit.$inferInsert;

// ============= KB Answer Feedback — doc69 B3 (Wave 5, AI#2) =============
// Closes the KB answer feedback loop: every thumbs up/down on an assistant answer
// (server/routers/aiLocalKbRouter.ts's `feedback` mutation) is now persisted here IN
// ADDITION to the pre-existing append-only knowledge/feedback.jsonl log (Stage 13.D,
// server/routes/aiLocalKnowledgeApi.ts) — the JSONL stays unchanged as a secondary
// log; this table is the QUERYABLE source. server/services/aiKbFeedbackSignal.ts
// aggregates it into a net rating (SUM of -1/0/1) per cited sourcePath and folds a
// BOUNDED multiplier into aiLocalKnowledgeService.retrieveKnowledge()'s existing
// score blend, flag-gated by KB_FEEDBACK_RERANK_ENABLED (default OFF — pure semantic
// ranking is unchanged until an operator opts in).
//
// `citations` is a SNAPSHOT (jsonb array of {id?, sourcePath}) of what was shown for
// that answer at feedback time — NOT a live FK to any chunk/embedding row, so a later
// re-embed/removal of that source never breaks this table or an old vote's meaning.
//
// Additive migration: drizzle/0306_kb_answer_feedback.sql (CREATE TABLE IF NOT
// EXISTS, owner `aoi`) — NOT applied by this task, ships unapplied until an operator
// with the `aoi` role runs it. Every read/write path MUST treat a missing table (pg
// error 42P01, walked via server/_core/dbErrors.ts's isMissingTable cause-walker —
// NOT a naive `.code` check, which misses drizzle-orm's DrizzleQueryError wrapping)
// as "no signal" / "not persisted" — see aiKbFeedbackSignal.ts.
export const kbAnswerFeedback = pgTable("kb_answer_feedback", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  // FE-generated per-turn message id (Stage 13.D's `messageId`) — a stable handle
  // for "which answer", not a FK to any chat-messages table.
  answerId: varchar("answerId", { length: 100 }).notNull(),
  rating: integer("rating").notNull(), // -1 | 0 | 1
  citations: jsonb("citations").$type<Array<{ id?: string; sourcePath: string }>>().default([]),
  userId: integer("userId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_kb_answer_feedback_answer").on(table.answerId),
  index("idx_kb_answer_feedback_created").on(table.createdAt),
  index("idx_kb_answer_feedback_rating").on(table.rating),
]);

export type KbAnswerFeedback = typeof kbAnswerFeedback.$inferSelect;
export type InsertKbAnswerFeedback = typeof kbAnswerFeedback.$inferInsert;
