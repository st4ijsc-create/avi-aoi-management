/**
 * AI Report Generation Router
 * 
 * Endpoints for generating AI-powered quality and performance reports.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import {
  generateDailyQualitySummary,
  generateRCAReport,
  generateModelPerformanceReport,
  generateExecutiveSummary,
  generateReport,
} from "../services/aiReportGenerator";
// doc 69 W0-3 — factory-scope + per-user rate limit (security gap: NO ownership check
// existed against the calling user, and only the global/IP rate limiter guarded these
// expensive report-generation mutations). See server/_core/aiAnalyticsScope.ts.
//
// SECURITY REVIEW FOLLOW-UP (Wave 0 fix #1): `modelPerformance`/`executiveSummary` are
// inherently global reports (the service ignores machineId for them) — `applyReportScope`
// cannot narrow them, so they use `applyGlobalReportScope` (admin-only) instead. Both
// helpers now live in aiAnalyticsScope.ts so server/routers/aiAnalysisHubRouter.ts (the
// sibling that bypassed all of this entirely) can reuse them verbatim (fix #3).
import { applyReportScope, applyGlobalReportScope } from "../_core/aiAnalyticsScope";

/**
 * ⚠ Xuất ra để `aiReportRouter.langGate.test.ts` hỏi **chính lược đồ đang chạy** thay vì đọc lại
 * mã nguồn bằng regex. Một lưới quét chuỗi `.default("vi")` sẽ xanh cả khi lược đồ bị thay ở chỗ
 * khác; `safeParse` thì không nói dối được.
 */
export const reportParamsSchema = z.object({
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  machineId: z.number().optional(),
  factoryId: z.number().optional(),
  /**
   * ★★★ G4-A VIỆC 1 lớp ① — HAI SỬA ĐỔI, MỖI CÁI ĐÓNG MỘT NỬA CỦA LỖ.
   *
   * (a) **`.default("vi")`, không còn `"en"`.** Đây là hệ chạy trong một nhà máy Việt Nam;
   *     `AIReportsPage` gọi bốn thủ tục này mà **KHÔNG** kèm `language` (cả 4 tab), nên
   *     `.default("en")` biến *mọi* lượt bấm "Tạo báo cáo" thành một lượt xin tiếng Anh — người
   *     dùng không hề chọn, và không có bề mặt nào để chọn. Trang nay gửi ngôn ngữ i18n hiện
   *     hành; mặc định này là lưới cho **mọi người gọi khác** (script, API ngoài) quên khai.
   *
   * (b) **Nới enum lên ba mã `vi`/`en`/`zh`.** Giao diện có tiếng Trung. Nếu (a) được vá mà enum
   *     vẫn là `["en","vi"]` thì một phiên `zh` gửi `"zh"` sẽ nhận **400 BAD_REQUEST** — bản vá
   *     lớp ① tự đẻ ra một lỗ mới ở lớp bên cạnh. Bảng câu `aiReportPhrases.ts` khai đủ ba ngôn
   *     ngữ, cưỡng chế bằng KIỂU, nên ba mã đều có nội dung thật để trả về.
   */
  language: z.enum(["en", "vi", "zh"]).default("vi"),
});

export const aiReportRouter = router({
  /**
   * Generate a Daily Quality Summary.
   */
  dailySummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      return generateDailyQualitySummary({
        ...input,
        reportType: "daily",
      });
    }),

  /**
   * Generate a Root Cause Investigation report.
   */
  rcaReport: protectedProcedure
    .input(reportParamsSchema.extend({
      triggerReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await applyReportScope(ctx, input);
      const report = await generateRCAReport({
        ...input,
        reportType: "rca",
      });

      // doc69 Wave2 A3 — close the loop on the report's actionItems the SAME way as
      // rootCauseRouter (server/services/ai/rcaActionSuggester.ts): only when scoped
      // to a real machineId (the report is otherwise factory/period-wide — no single
      // entity to safely bind write-tool args to). Additive; [] when nothing maps or
      // the viewer isn't permitted.
      const { suggestActionsForRecommendations } = await import("../services/ai/rcaActionSuggester");
      const suggestedActions = await suggestActionsForRecommendations(
        { recommendations: report.actionItems },
        {
          machineId: input.machineId ?? null,
          user: { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null },
          lang: input.language,
        },
      );

      return { ...report, suggestedActions };
    }),

  /**
   * Generate Model Performance report.
   *
   * doc 69 W0-3 security review fix #1 — this report is inherently global (the service
   * ignores machineId and returns the full AI model list), so it's restricted to the
   * global (admin) role rather than factory-narrowed.
   */
  modelPerformance: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyGlobalReportScope(ctx);
      return generateModelPerformanceReport({
        ...input,
        reportType: "model_performance",
      });
    }),

  /**
   * Generate Executive Summary (weekly/monthly).
   *
   * doc 69 W0-3 security review fix #1 — inherently global (all-factory KPIs/machine
   * rankings, machineId ignored by the service) → global (admin) role only.
   */
  executiveSummary: protectedProcedure
    .input(reportParamsSchema)
    .mutation(async ({ input, ctx }) => {
      await applyGlobalReportScope(ctx);
      return generateExecutiveSummary({
        ...input,
        reportType: "executive",
      });
    }),

  /**
   * Unified report generation endpoint. Branches its scope guard by reportType — the
   * two inherently-global types (model_performance/executive) get the admin-only guard,
   * the two machineId-filterable types (daily/rca) get the factory-scope guard. Without
   * this branch, `generate` would have remained a full bypass of fix #1 above.
   */
  generate: protectedProcedure
    .input(reportParamsSchema.extend({
      reportType: z.enum(["daily", "rca", "model_performance", "executive"]),
      triggerReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.reportType === "model_performance" || input.reportType === "executive") {
        await applyGlobalReportScope(ctx);
      } else {
        await applyReportScope(ctx, input);
      }
      return generateReport(input);
    }),
});
