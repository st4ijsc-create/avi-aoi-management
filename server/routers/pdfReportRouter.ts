/**
 * Report Template Router
 * Quản lý PDF report templates & custom report builder
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import * as db from "../db";
import { generateInspectionReportPDF, generateQualityReportPDF } from "../services/pdfTemplateService";
import type { PDFReportConfig, QualityReportData, InspectionReportData } from "../services/pdfTemplateService";

// ─── PDF Report Template Router ─────────────────────────────────────────────

export const pdfReportRouter = router({
  /**
   * Generate an inspection report PDF for a given inspection
   */
  generateInspectionPDF: protectedProcedure
    .input(z.object({
      inspectionId: z.number(),
      config: z.object({
        title: z.string().optional(),
        companyName: z.string().optional(),
        primaryColor: z.string().optional(),
        accentColor: z.string().optional(),
        confidential: z.boolean().optional(),
        pageSize: z.enum(["A4", "LETTER"]).optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      // Get inspection details
      const inspection = await db.getInspectionById(input.inspectionId);
      if (!inspection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy inspection" });
      }

      // Get measurement results
      const measurements = await db.getMeasurementResultsByInspection(input.inspectionId);

      // Get product model if available
      let productModel: InspectionReportData["productModel"];
      if ((inspection as any).productModelId) {
        const pm = await db.getProductModelById((inspection as any).productModelId);
        if (pm) {
          productModel = { name: pm.name, code: pm.code || "", description: pm.description || undefined };
        }
      }

      const data: InspectionReportData = {
        inspection: {
          id: inspection.id,
          serialNumber: (inspection as any).serialNumber || `INS-${inspection.id}`,
          overallResult: (inspection as any).overallResult || "OK",
          inspectionTime: (inspection as any).inspectionTime || new Date(),
          machineCode: (inspection as any).machineCode,
          machineName: (inspection as any).machineName,
          lineName: (inspection as any).lineName,
          stationName: (inspection as any).stationName,
          workshopName: (inspection as any).workshopName,
          factoryName: (inspection as any).factoryName,
          notes: (inspection as any).notes,
          acknowledgedBy: (inspection as any).acknowledgedBy,
          acknowledgedAt: (inspection as any).acknowledgedAt,
        },
        measurements: (measurements || []).map((m: any) => ({
          pointName: m.pointName || m.pointCode || "Unknown",
          measurementType: m.measurementType || "VISUAL",
          result: m.result || "OK",
          measuredValue: m.measuredValue,
          standardValue: m.standardValue,
          upperLimit: m.upperLimit,
          lowerLimit: m.lowerLimit,
          unit: m.unit,
          remark: m.remark,
        })),
        productModel,
      };

      const config: PDFReportConfig = {
        title: input.config?.title || `Báo cáo kiểm tra #${inspection.id}`,
        companyName: input.config?.companyName,
        primaryColor: input.config?.primaryColor,
        accentColor: input.config?.accentColor,
        confidential: input.config?.confidential,
        pageSize: input.config?.pageSize,
      };

      const pdfBuffer = await generateInspectionReportPDF(data, config);

      return {
        filename: `inspection-report-${inspection.id}.pdf`,
        contentType: "application/pdf",
        data: pdfBuffer.toString("base64"),
        size: pdfBuffer.length,
      };
    }),

  /**
   * Generate a quality summary report PDF
   */
  generateQualityPDF: protectedProcedure
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
        accentColor: z.string().optional(),
        confidential: z.boolean().optional(),
        pageSize: z.enum(["A4", "LETTER"]).optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { startDate, endDate, factoryId, workshopId, lineId } = input;

      // Get dashboard stats
      const stats = await db.getDashboardStats({
        startDate,
        endDate,
        factoryId,
        workshopId,
      });

      // Get daily trend
      const trendData = await db.getNGTrendByDay({ startDate, endDate });

      // Get top NG points
      const topNG = await db.getTopNGMeasurementPoints({ startDate, endDate, limit: 10 });

      // Get machine stats
      const topMachines = await db.getTopBottomMachines({
        startDate,
        endDate,
        factoryId,
        workshopId,
      });

      // Build report data
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
        filters: {},
      };

      // Get filter names
      if (factoryId) {
        const f = await db.getFactoryById(factoryId);
        if (f) data.filters!.factoryName = f.name;
      }
      if (workshopId) {
        const w = await db.getWorkshopById(workshopId);
        if (w) data.filters!.workshopName = w.name;
      }
      if (lineId) {
        const l = await db.getLineById(lineId);
        if (l) data.filters!.lineName = l.name;
      }

      const config: PDFReportConfig = {
        title: input.config?.title || "Báo cáo chất lượng tổng hợp",
        companyName: input.config?.companyName,
        primaryColor: input.config?.primaryColor,
        accentColor: input.config?.accentColor,
        confidential: input.config?.confidential,
        pageSize: input.config?.pageSize,
      };

      const pdfBuffer = await generateQualityReportPDF(data, config);

      return {
        filename: `quality-report-${startDate.toISOString().split("T")[0]}_${endDate.toISOString().split("T")[0]}.pdf`,
        contentType: "application/pdf",
        data: pdfBuffer.toString("base64"),
        size: pdfBuffer.length,
      };
    }),

  /**
   * List saved report templates (from existing reportTemplates table)
   */
  listTemplates: protectedProcedure
    .input(z.object({
      type: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const templates = await db.getReportTemplates();
      if (input?.type) {
        return templates.filter((t: any) => t.type === input.type);
      }
      return templates;
    }),

  /**
   * Save a report template
   */
  saveTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      type: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
      sections: z.object({
        includeYieldStats: z.boolean().default(true),
        includeNGAnalysis: z.boolean().default(true),
        includeMachineComparison: z.boolean().default(true),
        includeTrend: z.boolean().default(true),
        includeHeatmap: z.boolean().default(false),
        customSections: z.array(z.object({
          title: z.string(),
          type: z.string(),
          config: z.record(z.any()).optional(),
        })).optional(),
      }),
      config: z.object({
        companyName: z.string().optional(),
        primaryColor: z.string().optional(),
        accentColor: z.string().optional(),
        pageSize: z.enum(["A4", "LETTER"]).optional(),
        confidential: z.boolean().optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.createReportTemplate({
        name: input.name,
        type: input.type,
        sections: input.sections,
        customization: input.config || {},
        isDefault: false,
      });
      return result;
    }),

  /**
   * Delete a report template
   */
  deleteTemplate: adminProcedure
    .input(z.number())
    .mutation(async ({ input: id }) => {
      await db.deleteReportTemplate(id);
      return { success: true };
    }),
});
