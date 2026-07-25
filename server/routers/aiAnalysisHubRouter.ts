/**
 * AI Analysis Hub Router
 *
 * Unified router that lets users discover and select AI-powered
 * analysis capabilities for data analysis and image analysis.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import fs from "fs";

// ─── Service imports ──────────────────────────────────────────
import {
  describeDefect,
  compareImages,
  generateQAReport,
} from "../services/aiVisionLanguage";

import {
  findSimilarById,
  searchByImage,
} from "../services/aiImageEmbedding";

import {
  analyzeTimeSeries,
  forecastWithConfidenceInterval,
  seasonalDecompose,
  detectChangePoints,
  type TimeSeriesPoint,
} from "../services/aiTimeSeriesEngine";

import {
  generateDailyQualitySummary,
  generateRCAReport,
  generateModelPerformanceReport,
  generateExecutiveSummary,
} from "../services/aiReportGenerator";

import { resolveSafeImagePath } from "../utils/safeImagePath";

// doc 69 W0-3 security review fix #3 — this router calls the EXACT SAME
// aiReportGenerator functions as server/routers/aiReportRouter.ts but, before this fix,
// applied NO factory-scope check and NO per-user rate limit at all: any authenticated
// user could reach cross-factory report data through this sibling endpoint even after
// aiReportRouter itself was locked down. Reuses the identical composed guards (see
// server/_core/aiAnalyticsScope.ts) — same rate-limit bucket, same scope rules, same
// admin-only restriction on the two inherently-global report types.
import { applyReportScope, applyGlobalReportScope } from "../_core/aiAnalyticsScope";

// ─── Helpers ──────────────────────────────────────────────────
function resolveImagePath(imageKey: string): string {
  return resolveSafeImagePath(imageKey);
}

function loadImage(imageKey: string): Buffer {
  const imagePath = resolveImagePath(imageKey);
  if (!fs.existsSync(imagePath)) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Image not found: ${imageKey}` });
  }
  return fs.readFileSync(imagePath);
}

// ─── Available Capabilities ───────────────────────────────────
const capabilities = {
  imageAnalysis: [
    {
      id: "defect_description",
      name: "Defect Description (VLM)",
      description: "Use Vision-Language Model to describe defects in an inspection image",
      category: "image",
      endpoint: "aiAnalysisHub.imageDefectDescription",
      requiredInputs: ["imageKey"],
      optionalInputs: ["productModel", "machineCode", "inspectionPoint"],
    },
    {
      id: "image_comparison",
      name: "Image Comparison",
      description: "Compare two images to identify differences and defects",
      category: "image",
      endpoint: "aiAnalysisHub.imageComparison",
      requiredInputs: ["referenceImageKey", "testImageKey"],
      optionalInputs: ["productModel"],
    },
    {
      id: "similar_defect_search",
      name: "Similar Defect Search",
      description: "Find similar defect images using AI embeddings",
      category: "image",
      endpoint: "aiAnalysisHub.similarDefectSearch",
      requiredInputs: ["imageKey"],
      optionalInputs: ["topK", "minSimilarity"],
    },
    {
      id: "quick_quality_check",
      name: "Quick Quality Check",
      description: "Combined VLM defect description + similarity search for rapid quality assessment",
      category: "image",
      endpoint: "aiAnalysisHub.quickQualityCheck",
      requiredInputs: ["imageKey"],
      optionalInputs: ["productModel", "machineCode"],
    },
  ],
  dataAnalysis: [
    {
      id: "time_series_analysis",
      name: "Time Series Analysis",
      description: "Analyze production time series data for trends and anomalies",
      category: "data",
      endpoint: "aiAnalysisHub.timeSeriesAnalysis",
      requiredInputs: ["dataPoints", "algorithm"],
      optionalInputs: ["sensitivity", "seasonalPeriod"],
    },
    {
      id: "production_forecast",
      name: "Production Forecast",
      description: "Forecast future production metrics with confidence intervals",
      category: "data",
      endpoint: "aiAnalysisHub.productionForecast",
      requiredInputs: ["dataPoints", "horizonSteps"],
      optionalInputs: ["confidenceLevel", "seasonalPeriod"],
    },
    {
      id: "change_point_detection",
      name: "Change Point Detection",
      description: "Detect significant changes in production data patterns",
      category: "data",
      endpoint: "aiAnalysisHub.changePointDetection",
      requiredInputs: ["dataPoints"],
      optionalInputs: ["penalty", "minSegmentLength"],
    },
    {
      id: "seasonal_decomposition",
      name: "Seasonal Decomposition",
      description: "Decompose time series into trend, seasonal, and residual components",
      category: "data",
      endpoint: "aiAnalysisHub.seasonalDecomposition",
      requiredInputs: ["dataPoints", "period"],
      optionalInputs: [],
    },
  ],
  reportGeneration: [
    {
      id: "daily_quality_summary",
      name: "Daily Quality Summary",
      description: "AI-generated daily quality summary report",
      category: "report",
      endpoint: "aiAnalysisHub.dailyQualitySummary",
      requiredInputs: ["startDate", "endDate"],
      optionalInputs: ["machineId", "factoryId", "language"],
    },
    {
      id: "root_cause_analysis",
      name: "Root Cause Analysis Report",
      description: "AI-powered root cause investigation report",
      category: "report",
      endpoint: "aiAnalysisHub.rootCauseAnalysis",
      requiredInputs: ["startDate", "endDate"],
      optionalInputs: ["machineId", "factoryId", "language", "triggerReason"],
    },
    {
      id: "model_performance_report",
      name: "Model Performance Report",
      description: "AI model performance analysis report",
      category: "report",
      endpoint: "aiAnalysisHub.modelPerformanceReport",
      requiredInputs: ["startDate", "endDate"],
      optionalInputs: ["machineId", "factoryId", "language"],
    },
    {
      id: "executive_summary",
      name: "Executive Summary",
      description: "AI-generated executive summary for management",
      category: "report",
      endpoint: "aiAnalysisHub.executiveSummary",
      requiredInputs: ["startDate", "endDate"],
      optionalInputs: ["machineId", "factoryId", "language"],
    },
  ],
};

// ─── Schemas ──────────────────────────────────────────────────
const timeSeriesPointSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
});

const reportParamsSchema = z.object({
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  machineId: z.number().optional(),
  factoryId: z.number().optional(),
  language: z.enum(["en", "vi"]).default("en"),
});

// ─── Router ───────────────────────────────────────────────────
export const aiAnalysisHubRouter = router({
  /**
   * List all available AI analysis capabilities for user selection.
   */
  getCapabilities: protectedProcedure
    .input(z.object({
      category: z.enum(["all", "image", "data", "report"]).default("all"),
    }).optional())
    .query(({ input }) => {
      const cat = input?.category ?? "all";
      if (cat === "all") return capabilities;
      if (cat === "image") return { imageAnalysis: capabilities.imageAnalysis };
      if (cat === "data") return { dataAnalysis: capabilities.dataAnalysis };
      return { reportGeneration: capabilities.reportGeneration };
    }),

  // ═══════════════════════════════════════════════════════════
  // IMAGE ANALYSIS ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  /**
   * Describe defects in an image using VLM.
   */
  imageDefectDescription: protectedProcedure
    .input(z.object({
      imageKey: z.string().min(1),
      productModel: z.string().optional(),
      machineCode: z.string().optional(),
      inspectionPoint: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = loadImage(input.imageKey);
      const result = await describeDefect(imageBuffer, {
        productModel: input.productModel,
        machineCode: input.machineCode,
        inspectionPoint: input.inspectionPoint,
      });
      return { analysisType: "defect_description", ...result };
    }),

  /**
   * Compare reference vs test images.
   */
  imageComparison: protectedProcedure
    .input(z.object({
      referenceImageKey: z.string().min(1),
      testImageKey: z.string().min(1),
      productModel: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const refBuffer = loadImage(input.referenceImageKey);
      const testBuffer = loadImage(input.testImageKey);
      const result = await compareImages(refBuffer, testBuffer, {
        productModel: input.productModel,
      });
      return { analysisType: "image_comparison", ...result };
    }),

  /**
   * Search for similar defect images.
   */
  similarDefectSearch: protectedProcedure
    .input(z.object({
      imageKey: z.string().min(1),
      modelId: z.number().optional(),
      topK: z.number().min(1).max(50).default(10),
      minSimilarity: z.number().min(0).max(1).default(0.7),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = await fs.promises.readFile(resolveImagePath(input.imageKey));
      const { results } = await searchByImage(
        input.modelId,
        imageBuffer,
        input.topK,
        { minSimilarity: input.minSimilarity },
      );
      return { analysisType: "similar_defect_search", totalFound: results.length, results };
    }),

  /**
   * Quick quality check: combined VLM description + similarity search.
   */
  quickQualityCheck: protectedProcedure
    .input(z.object({
      imageKey: z.string().min(1),
      modelId: z.number().optional(),
      productModel: z.string().optional(),
      machineCode: z.string().optional(),
      topK: z.number().min(1).max(20).default(5),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = loadImage(input.imageKey);

      // Run VLM description and similarity search in parallel
      const [description, similarImages] = await Promise.all([
        describeDefect(imageBuffer, {
          productModel: input.productModel,
          machineCode: input.machineCode,
        }).catch(e => ({ error: String(e), description: null })),
        searchByImage(input.modelId, imageBuffer, input.topK, { minSimilarity: 0.5 })
          .then((result) => result.results)
          .catch(() => [] as any[]),
      ]);

      return {
        analysisType: "quick_quality_check",
        defectDescription: description,
        similarDefects: {
          totalFound: similarImages.length,
          results: similarImages,
        },
      };
    }),

  // ═══════════════════════════════════════════════════════════
  // DATA ANALYSIS ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  /**
   * Time series analysis with selected algorithm.
   */
  timeSeriesAnalysis: protectedProcedure
    .input(z.object({
      dataPoints: z.array(timeSeriesPointSchema).min(10),
      algorithm: z.enum(["ewma", "holt_winters", "isolation_forest", "seasonal_decompose", "change_point"]),
      sensitivity: z.number().min(0).max(1).default(0.5),
      seasonalPeriod: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await analyzeTimeSeries(
        input.dataPoints as TimeSeriesPoint[],
        { algorithm: input.algorithm, sensitivity: input.sensitivity, seasonalPeriod: input.seasonalPeriod } as any,
      );
      return { analysisType: "time_series_analysis", ...result, algorithm: input.algorithm };
    }),

  /**
   * Production metric forecasting.
   */
  productionForecast: protectedProcedure
    .input(z.object({
      dataPoints: z.array(timeSeriesPointSchema).min(10),
      horizonSteps: z.number().min(1).max(365),
      confidenceLevel: z.number().min(0.5).max(0.99).default(0.95),
      seasonalPeriod: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await forecastWithConfidenceInterval(
        input.dataPoints as TimeSeriesPoint[],
        input.horizonSteps,
        "ewma",
        { confidenceLevel: input.confidenceLevel, seasonalPeriod: input.seasonalPeriod } as any,
      );
      return { analysisType: "production_forecast", horizon: input.horizonSteps, ...result };
    }),

  /**
   * Change point detection in production data.
   */
  changePointDetection: protectedProcedure
    .input(z.object({
      dataPoints: z.array(timeSeriesPointSchema).min(10),
      penalty: z.number().min(0).max(100).optional(),
      minSegmentLength: z.number().min(2).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await detectChangePoints(
        input.dataPoints as TimeSeriesPoint[],
        input.penalty,
      );
      return { analysisType: "change_point_detection", ...result };
    }),

  /**
   * Seasonal decomposition of time series data.
   */
  seasonalDecomposition: protectedProcedure
    .input(z.object({
      dataPoints: z.array(timeSeriesPointSchema).min(10),
      period: z.number().min(2),
    }))
    .mutation(async ({ input }) => {
      const result = await seasonalDecompose(
        input.dataPoints as TimeSeriesPoint[],
        input.period,
      );
      return { analysisType: "seasonal_decomposition", period: input.period, ...result };
    }),

  // ═══════════════════════════════════════════════════════════
  // REPORT GENERATION ENDPOINTS
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate daily quality summary report.
   */
  dailyQualitySummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      const result = await generateDailyQualitySummary({ ...input, reportType: "daily" });
      return { analysisType: "daily_quality_summary", ...result };
    }),

  /**
   * Generate root cause analysis report.
   */
  rootCauseAnalysis: protectedProcedure
    .input(reportParamsSchema.extend({ triggerReason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      const result = await generateRCAReport({ ...input, reportType: "rca" });
      return { analysisType: "root_cause_analysis", ...result };
    }),

  /**
   * Generate model performance report. doc 69 W0-3 fix #1 — inherently global
   * (ignores machineId), so admin-only rather than factory-narrowed.
   */
  modelPerformanceReport: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyGlobalReportScope(ctx);
      const result = await generateModelPerformanceReport({ ...input, reportType: "model_performance" });
      return { analysisType: "model_performance_report", ...result };
    }),

  /**
   * Generate executive summary report. doc 69 W0-3 fix #1 — inherently global
   * (all-factory KPIs/machine rankings), so admin-only rather than factory-narrowed.
   */
  executiveSummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyGlobalReportScope(ctx);
      const result = await generateExecutiveSummary({ ...input, reportType: "executive" });
      return { analysisType: "executive_summary", ...result };
    }),
});
