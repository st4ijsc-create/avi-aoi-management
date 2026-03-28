/**
 * PowerPoint Export Router
 * Xuất dashboard/report sang PowerPoint
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { exportQualityReportToPowerPoint, exportComparisonToPowerPoint, exportDashboardToPowerPoint } from "../services/powerpointService";
import { generateComparison } from "../services/dataComparisonService";
import type { QualityReportData } from "../services/pdfTemplateService";
import type { ComparisonPeriod } from "../services/dataComparisonService";
import type { DashboardSlideData, PowerPointConfig } from "../services/powerpointService";

export const powerpointRouter = router({
  /**
   * Export quality report as PowerPoint
   */
  exportQualityReport: protectedProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      config: z.object({
        title: z.string().optional(),
        companyName: z.string().optional(),
        primaryColor: z.string().optional(),
        author: z.string().optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { startDate, endDate, factoryId, workshopId, lineId } = input;

      // Gather data
      const stats = await db.getDashboardStats({ startDate, endDate, factoryId, workshopId });
      const trendData = await db.getNGTrendByDay({ startDate, endDate });
      const topNG = await db.getTopNGMeasurementPoints({ startDate, endDate, limit: 10 });
      const topMachines = await db.getTopBottomMachines({ startDate, endDate, factoryId, workshopId });

      const data: QualityReportData = {
        period: { start: startDate, end: endDate },
        summary: {
          totalInspections: stats?.total || 0,
          okCount: stats?.ok || 0,
          ngCount: stats?.ng || 0,
          ntfCount: stats?.ntf || 0,
          yieldRate: stats?.yieldRate || 0,
          ngRate: stats?.total ? ((stats.ng || 0) / stats.total) * 100 : 0,
        },
        byMachine: (topMachines?.topMachines || []).map((m: any) => ({
          machineName: m.machineName || m.name || "Unknown",
          machineCode: m.machineCode || m.code || "",
          totalInspections: Number(m.totalInspections || m.total || 0),
          okCount: Number(m.okCount || m.ok || 0),
          ngCount: Number(m.ngCount || m.ng || 0),
          yieldRate: Number(m.yieldRate || 0),
        })),
        topNGPoints: (topNG || []).map((p: any) => ({
          pointName: p.pointName || p.name || "Unknown",
          ngCount: Number(p.ngCount || 0),
          percentage: Number(p.percentage || 0),
        })),
        dailyTrend: (trendData || []).map((d: any) => ({
          date: typeof d.date === "string" ? d.date : new Date(d.date).toLocaleDateString("vi-VN"),
          totalInspections: Number(d.totalCount || 0),
          okCount: Number(d.okCount || 0),
          ngCount: Number(d.ngCount || 0),
          yieldRate: Number(d.totalCount) > 0 ? (Number(d.okCount) / Number(d.totalCount)) * 100 : 0,
        })),
      };

      const pptxBuffer = await exportQualityReportToPowerPoint(data, {
        title: input.config?.title || "Báo cáo chất lượng",
        companyName: input.config?.companyName,
        primaryColor: input.config?.primaryColor,
        author: input.config?.author || ctx.user?.name,
      });

      return {
        filename: `quality-report-${startDate.toISOString().split("T")[0]}_${endDate.toISOString().split("T")[0]}.pptx`,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        data: pptxBuffer.toString("base64"),
        size: pptxBuffer.length,
      };
    }),

  /**
   * Export comparison report as PowerPoint
   */
  exportComparison: protectedProcedure
    .input(z.object({
      periodType: z.enum(["day", "week", "month", "quarter", "custom"]),
      currentStart: z.coerce.date(),
      currentEnd: z.coerce.date(),
      previousStart: z.coerce.date().optional(),
      previousEnd: z.coerce.date().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      config: z.object({
        title: z.string().optional(),
        companyName: z.string().optional(),
        primaryColor: z.string().optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const comparisonData = await generateComparison({
        periodType: input.periodType as ComparisonPeriod,
        currentStart: input.currentStart,
        currentEnd: input.currentEnd,
        previousStart: input.previousStart,
        previousEnd: input.previousEnd,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
      });

      const pptxBuffer = await exportComparisonToPowerPoint(comparisonData, {
        title: input.config?.title || "Báo cáo so sánh",
        companyName: input.config?.companyName,
        primaryColor: input.config?.primaryColor,
        author: ctx.user?.name,
      });

      return {
        filename: `comparison-report-${input.periodType}.pptx`,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        data: pptxBuffer.toString("base64"),
        size: pptxBuffer.length,
      };
    }),

  /**
   * Export custom dashboard slides as PowerPoint
   */
  exportCustom: protectedProcedure
    .input(z.object({
      slides: z.array(z.object({
        title: z.string(),
        kpis: z.array(z.object({
          label: z.string(),
          value: z.string(),
          trend: z.string().optional(),
          trendDirection: z.enum(["up", "down", "same"]).optional(),
        })),
        charts: z.array(z.object({
          type: z.enum(["bar", "line", "pie", "doughnut"]),
          title: z.string(),
          data: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
          labels: z.array(z.string()),
        })).optional(),
        tables: z.array(z.object({
          title: z.string(),
          headers: z.array(z.string()),
          rows: z.array(z.array(z.string())),
        })).optional(),
      })),
      config: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        companyName: z.string().optional(),
        primaryColor: z.string().optional(),
        author: z.string().optional(),
        includeCharts: z.boolean().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const pptxBuffer = await exportDashboardToPowerPoint(
        input.slides as DashboardSlideData[],
        input.config as PowerPointConfig
      );

      return {
        filename: `custom-report-${Date.now()}.pptx`,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        data: pptxBuffer.toString("base64"),
        size: pptxBuffer.length,
      };
    }),
});
