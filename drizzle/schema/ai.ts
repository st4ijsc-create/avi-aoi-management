// Schema domain: AI & Annotation tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { changeTypeEnum, alertTypeEnum_1, maintenanceUrgencyEnum, statusEnum_5, analysisTypeEnum, statusEnum_6, statusEnum_8, periodTypeEnum_1, suggestionTypeEnum, statusEnum_9, feedbackTypeEnum, errorCategoryEnum, accuracyTrendEnum, exportFormatEnum_1, statusEnum_10 } from "./enums";

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
]);

export type PredictiveAlert = typeof predictiveAlerts.$inferSelect;
export type InsertPredictiveAlert = typeof predictiveAlerts.$inferInsert;


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
    recommendations: Array<{action: string; priority: "high" | "medium" | "low"; expectedImpact: string}>;
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
