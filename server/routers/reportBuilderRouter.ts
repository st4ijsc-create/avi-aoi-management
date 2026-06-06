/**
 * Custom Report Builder Router
 * Drag-drop report builder cho người dùng tự tạo báo cáo
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import * as db from "../db";
import { getDb } from "../db/connection";
import { sql, eq, desc } from "drizzle-orm";

// ─── Widget Types for Report Builder ────────────────────────────────────────

const widgetSchema = z.object({
  id: z.string(),
  type: z.enum([
    "kpi_card",
    "bar_chart",
    "line_chart",
    "pie_chart",
    "table",
    "text_block",
    "divider",
    "image",
    "yield_trend",
    "ng_analysis",
    "machine_comparison",
    "shift_analysis",
    "heatmap",
  ]),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  config: z.record(z.string(), z.any()).optional(),
});

const reportDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  widgets: z.array(widgetSchema),
  layout: z.object({
    cols: z.number().default(12),
    rowHeight: z.number().default(60),
    margin: z.tuple([z.number(), z.number()]).default([10, 10]),
  }).optional(),
  filters: z.object({
    factoryId: z.number().optional(),
    workshopId: z.number().optional(),
    lineId: z.number().optional(),
    dateRange: z.enum(["today", "this_week", "this_month", "last_30_days", "custom"]).optional(),
    customStartDate: z.coerce.date().optional(),
    customEndDate: z.coerce.date().optional(),
  }).optional(),
  styling: z.object({
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    fontFamily: z.string().optional(),
    darkMode: z.boolean().optional(),
  }).optional(),
  isPublic: z.boolean().default(false),
});

export const reportBuilderRouter = router({
  /**
   * List user's saved report definitions
   */
  list: protectedProcedure
    .input(z.object({
      includePublic: z.boolean().default(true),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conn = await getDb();
      if (!conn) return { reports: [], total: 0 };

      const limit = input?.limit || 20;
      const offset = input?.offset || 0;
      const userId = ctx.user.id;

      // Query from saved custom reports (stored in report_templates with special type)
      try {
        const query = sql`
          SELECT rt.*, 
            CASE WHEN rt."createdBy" = ${userId} THEN true ELSE false END as "isOwner"
          FROM report_templates rt
          WHERE (rt."createdBy" = ${userId} OR rt."isDefault" = true)
          ORDER BY rt."updatedAt" DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        const result: any = await conn.execute(query);
        const rows = result.rows || result;

        const countQuery = sql`
          SELECT COUNT(*)::int as total
          FROM report_templates rt
          WHERE (rt."createdBy" = ${userId} OR rt."isDefault" = true)
        `;
        const countResult: any = await conn.execute(countQuery);
        const countRows = countResult.rows || countResult;
        const total = countRows[0]?.total || 0;

        return { reports: rows, total };
      } catch {
        return { reports: [], total: 0 };
      }
    }),

  /**
   * Get a single report definition by ID
   */
  getById: protectedProcedure
    .input(z.number())
    .query(async ({ input: id }) => {
      const conn = await getDb();
      if (!conn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      try {
        const result: any = await conn.execute(sql`
          SELECT * FROM report_templates WHERE id = ${id}
        `);
        const rows = result.rows || result;
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Không tìm thấy báo cáo" });
        return rows[0];
      } catch (err: any) {
        if (err.code === "NOT_FOUND") throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  /**
   * Save/create a report definition
   */
  save: protectedProcedure
    .input(reportDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await db.createReportTemplate({
        name: input.name,
        type: "CUSTOM",
        sections: {
          widgets: input.widgets,
          layout: input.layout,
          filters: input.filters,
          styling: input.styling,
          description: input.description,
        },
        customization: input.styling || {},
        isDefault: input.isPublic,
      });
      return result;
    }),

  /**
   * Update an existing report definition
   */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      data: reportDefinitionSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateReportTemplate(input.id, {
        name: input.data.name,
        sections: {
          widgets: input.data.widgets,
          layout: input.data.layout,
          filters: input.data.filters,
          styling: input.data.styling,
          description: input.data.description,
        },
        customization: input.data.styling || {},
        isDefault: input.data.isPublic,
      });
      return { success: true, id: input.id };
    }),

  /**
   * Delete a report definition
   */
  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      await db.deleteReportTemplate(id);
      return { success: true };
    }),

  /**
   * Duplicate an existing report
   */
  duplicate: protectedProcedure
    .input(z.object({
      id: z.number(),
      newName: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getDb();
      if (!conn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      try {
        const result: any = await conn.execute(sql`
          SELECT * FROM report_templates WHERE id = ${input.id}
        `);
        const rows = result.rows || result;
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

        const source = rows[0];
        const newTemplate = await db.createReportTemplate({
          name: input.newName,
          type: "CUSTOM",
          sections: source.sections,
          customization: source.customization || {},
          isDefault: false,
        });
        return newTemplate;
      } catch (err: any) {
        if (err.code === "NOT_FOUND") throw err;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
      }
    }),

  /**
   * Get available widget types with their descriptions
   */
  getWidgetTypes: protectedProcedure.query(() => {
    return [
      { type: "kpi_card", label: "KPI Card", description: "Hiển thị 1 chỉ số KPI", icon: "hash", category: "basic" },
      { type: "bar_chart", label: "Biểu đồ cột", description: "Biểu đồ dạng cột", icon: "bar-chart", category: "chart" },
      { type: "line_chart", label: "Biểu đồ đường", description: "Biểu đồ dạng đường", icon: "trending-up", category: "chart" },
      { type: "pie_chart", label: "Biểu đồ tròn", description: "Biểu đồ dạng tròn", icon: "pie-chart", category: "chart" },
      { type: "table", label: "Bảng dữ liệu", description: "Bảng hiển thị dữ liệu", icon: "table", category: "data" },
      { type: "text_block", label: "Khối văn bản", description: "Nội dung text tùy chỉnh", icon: "type", category: "basic" },
      { type: "divider", label: "Ngăn cách", description: "Đường kẻ ngăn cách", icon: "minus", category: "basic" },
      { type: "yield_trend", label: "Xu hướng Yield", description: "Biểu đồ yield theo thời gian", icon: "trending-up", category: "analytics" },
      { type: "ng_analysis", label: "Phân tích NG", description: "Top điểm NG nhiều nhất", icon: "alert-triangle", category: "analytics" },
      { type: "machine_comparison", label: "So sánh máy", description: "So sánh hiệu suất giữa các máy", icon: "bar-chart-2", category: "analytics" },
      { type: "shift_analysis", label: "Phân tích ca", description: "So sánh hiệu suất theo ca làm", icon: "clock", category: "analytics" },
      { type: "heatmap", label: "Bản đồ nhiệt", description: "Heatmap điểm NG", icon: "grid", category: "analytics" },
    ];
  }),

  /**
   * Get widget data based on widget type and configuration
   */
  getWidgetData: protectedProcedure
    .input(z.object({
      widgetType: z.string(),
      config: z.record(z.string(), z.any()).optional(),
      filters: z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        factoryId: z.number().optional(),
        workshopId: z.number().optional(),
        lineId: z.number().optional(),
      }).optional(),
    }))
    .query(async ({ input }) => {
      const { widgetType, config, filters } = input;
      const startDate = filters?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = filters?.endDate || new Date();

      switch (widgetType) {
        case "kpi_card": {
          const stats = await db.getDashboardStats({
            startDate,
            endDate,
            factoryId: filters?.factoryId,
            workshopId: filters?.workshopId,
          });
          const metric = config?.metric || "totalInspections";
          const value = (stats as any)?.[metric] ?? 0;
          return { value, metric };
        }

        case "yield_trend":
        case "line_chart": {
          const data = await db.getNGTrendByDay({ startDate, endDate });
          return { data };
        }

        case "ng_analysis":
        case "bar_chart": {
          const data = await db.getTopNGMeasurementPoints({
            startDate,
            endDate,
            limit: config?.limit || 10,
          });
          return { data };
        }

        case "machine_comparison": {
          const data = await db.getTopBottomMachines({
            startDate,
            endDate,
            factoryId: filters?.factoryId,
            workshopId: filters?.workshopId,
          } as any);
          return { data };
        }

        case "shift_analysis": {
          const data = await db.getShiftStats({
            startDate,
            endDate,
            factoryId: filters?.factoryId,
          });
          return { data };
        }

        case "table": {
          const stats = await db.getDashboardStats({
            startDate,
            endDate,
            factoryId: filters?.factoryId,
            workshopId: filters?.workshopId,
          });
          return { data: stats };
        }

        default:
          return { data: null };
      }
    }),
});
