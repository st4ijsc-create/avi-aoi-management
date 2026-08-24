/**
 * AI Time Series Anomaly Detection Router
 * 
 * Endpoints for time series analysis, forecasting, anomaly detection,
 * seasonal decomposition, and change point detection on AOI production data.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { router, moduleProcedure } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
import { factoryIdsInScope, resolveFactoryScope } from "../_core/aiAnalyticsScope";
import { resolveDataScope, scopeLabelsOf, type ScopeLabels } from "../_core/accessControl";
import {
  analyzeTimeSeries,
  analyzeMultivariate,
  forecastWithConfidenceInterval,
  seasonalDecompose,
  detectChangePoints,
  ewma,
  ewmaForecast,
  type TimeSeriesPoint,
  type MultivariatePoint,
} from "../services/aiTimeSeriesEngine";
import { getDb } from "../db/connection";
import { dailyStatistics, machines } from "../../drizzle/schema";
import { MACHINE_TYPES } from "../constants/machineTypes";
import { finalYield } from "../utils/kpi";

const timeSeriesPointSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
});

const multivariatePointSchema = z.object({
  timestamp: z.number(),
  values: z.record(z.string(), z.number()),
});

const algorithmSchema = z.enum([
  "ewma",
  "holt_winters",
  "isolation_forest",
  "seasonal_decompose",
  "change_point",
]);

export const aiTimeSeriesRouter = router({
  /**
   * Full time series analysis with chosen algorithm.
   */
  analyze: protectedProcedure
    .input(z.object({
      data: z.array(timeSeriesPointSchema).min(3),
      algorithm: algorithmSchema,
      alpha: z.number().min(0).max(1).optional(),
      beta: z.number().min(0).max(1).optional(),
      gamma: z.number().min(0).max(1).optional(),
      seasonLength: z.number().int().min(2).optional(),
      threshold: z.number().positive().optional(),
      numTrees: z.number().int().min(1).max(1000).optional(),
      sampleSize: z.number().int().min(1).max(10000).optional(),
      horizon: z.number().int().min(1).max(365).optional(),
      // doc69 A4 (audit U5) — only consumed by algorithm:"isolation_forest"; lets a
      // caller pin the PRNG seed for reproducible anomaly scores (e.g. re-running
      // the exact same analysis for an audit trail). Omitting it uses the engine's
      // fixed default seed, which is ALSO deterministic (not Math.random anymore).
      seed: z.number().int().optional(),
    }))
    .mutation(({ input }) => {
      return analyzeTimeSeries(input.data as TimeSeriesPoint[], {
        algorithm: input.algorithm,
        alpha: input.alpha,
        beta: input.beta,
        gamma: input.gamma,
        seasonLength: input.seasonLength,
        threshold: input.threshold,
        numTrees: input.numTrees,
        sampleSize: input.sampleSize,
        horizon: input.horizon,
        seed: input.seed,
      });
    }),

  /**
   * Forecast future values with confidence intervals.
   */
  forecast: protectedProcedure
    .input(z.object({
      data: z.array(timeSeriesPointSchema).min(3),
      horizon: z.number().int().min(1).max(365).default(12),
      algorithm: z.enum(["ewma", "holt_winters"]).default("ewma"),
      alpha: z.number().min(0).max(1).optional(),
      beta: z.number().min(0).max(1).optional(),
      gamma: z.number().min(0).max(1).optional(),
      seasonLength: z.number().int().min(2).optional(),
    }))
    .query(({ input }) => {
      return forecastWithConfidenceInterval(
        input.data as TimeSeriesPoint[],
        input.horizon,
        input.algorithm,
        { alpha: input.alpha, beta: input.beta, gamma: input.gamma, seasonLength: input.seasonLength },
      );
    }),

  /**
   * Detect anomalies in multivariate data using Isolation Forest.
   */
  detectAnomalies: protectedProcedure
    .input(z.object({
      data: z.array(multivariatePointSchema).min(3),
      numTrees: z.number().int().min(1).max(1000).default(100),
      sampleSize: z.number().int().min(1).max(10000).default(256),
      threshold: z.number().min(0).max(1).default(0.65),
      seed: z.number().int().optional(),
    }))
    .mutation(({ input }) => {
      return analyzeMultivariate(
        input.data as MultivariatePoint[],
        { numTrees: input.numTrees, sampleSize: input.sampleSize, threshold: input.threshold, seed: input.seed },
      );
    }),

  /**
   * Seasonal decomposition (Trend + Seasonal + Residual).
   */
  decompose: protectedProcedure
    .input(z.object({
      data: z.array(timeSeriesPointSchema).min(10),
      period: z.number().int().min(2).default(24),
    }))
    .query(({ input }) => {
      return seasonalDecompose(input.data as TimeSeriesPoint[], input.period);
    }),

  /**
   * Change point detection (CUSUM-based).
   */
  changePoints: protectedProcedure
    .input(z.object({
      data: z.array(timeSeriesPointSchema).min(10),
      threshold: z.number().positive().default(4.0),
    }))
    .query(({ input }) => {
      return detectChangePoints(input.data as TimeSeriesPoint[], input.threshold);
    }),

  /**
   * Combined: fetch production metric from DB and run the requested analysis.
   * Used by AITimeSeriesPage for user-facing analysis via metric name + period.
   */
  analyzeMetric: protectedProcedure
    .input(z.object({
      metric: z.enum(["defect_rate", "yield_rate", "inspection_count", "throughput"]),
      period: z.enum(["1d", "7d", "30d", "90d"]).default("30d"),
      analysisType: z.enum(["analyze", "forecast", "anomaly", "decompose", "changepoints"]).default("analyze"),
      // doc69 A4 (audit U5) — previously this always blended EVERY machine
      // (every AOI/AVI/SPI/... station) into one series; a single mixed line was
      // often meaningless (e.g. an AOI's defect_rate scale vs an SPI's aren't
      // comparable). Both optional — omitting both preserves the old all-machines
      // behaviour exactly.
      machineId: z.number().int().positive().optional(),
      machineType: z.enum(MACHINE_TYPES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database unavailable");

      const days = ({ "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as const)[input.period] ?? 30;
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const conditions = [gte(dailyStatistics.date, startDate), lte(dailyStatistics.date, endDate)];
      if (input.machineId) conditions.push(eq(dailyStatistics.machineId, input.machineId));
      if (input.machineType) conditions.push(eq(machines.machineType, input.machineType));

      // ── PHẠM VI DỮ LIỆU (2026-08-18, nhóm B #4) ────────────────────────────────────────────
      // `protectedProcedure` chỉ kiểm ĐÃ ĐĂNG NHẬP; trước dòng này thủ tục quét **TOÀN BỘ
      // `daily_statistics` của mọi nhà máy** rồi trả về một chuỗi thời gian gộp — bất kỳ tài
      // khoản nào cũng đọc được sản lượng/tỉ lệ NG của mọi nhà máy trong hệ.
      // Dùng ĐÚNG bộ phân giải đã có cho bề mặt AI (`_core/aiAnalyticsScope`, xây trên cùng
      // `accessControl.getUserAssignmentCodes` mà `/history` dùng) — không cơ chế thứ hai.
      // ★ `daily_statistics.factoryId` là NOT NULL + có index `idx_stats_factory_date` ⇒ 0 DDL.
      const phamVi = await resolveFactoryScope(ctx.user);
      if (!phamVi.isGlobal) {
        const factoryIds = await factoryIdsInScope(phamVi);
        if (factoryIds.length === 0) {
          // ⚠ TỪ CHỐI TRUNG THỰC — nói ĐÚNG lý do. Một câu "không có dữ liệu" ở đây dạy người
          // dùng rằng hệ thống hỏng trong khi sự thật là phạm vi của họ rỗng.
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "viewAiTimeSeries", reason: "noFactoryAssigned" },
            "Tài khoản của bạn CHƯA ĐƯỢC GÁN nhà máy nào, nên phạm vi xem của bạn đang RỖNG và " +
              "chuỗi thời gian này không được phép trả về số liệu của bất kỳ nhà máy nào. Đây là " +
              "giới hạn PHẠM VI của tài khoản, KHÔNG phải kết luận về tình trạng nhà xưởng. Liên hệ " +
              "quản trị viên để được gán nhà máy.",
          );
        }
        conditions.push(inArray(dailyStatistics.factoryId, factoryIds));
      }

      /**
       * ⚠⚠ BA Ô NHÃN LẤY QUA `scopeLabelsOf()`, **KHÔNG** `{...resolved}`.
       * `resolveDataScope` trả về CẢ `filter` — một đối tượng SQL của drizzle mang tham chiếu
       * VÒNG. Spread nguyên khối ⇒ superjson chết `Converting circular structure to JSON` ⇒ **500
       * cho mọi người dùng**, và `tsc` KHÔNG bắt được (thuộc tính thừa chỉ bị cấm với object
       * literal). Đo được ngày 2026-08-17 trên `dashboard.getStats`. Xem `accessControlLabels.ts`.
       */
      const nhan: ScopeLabels = scopeLabelsOf(await resolveDataScope(ctx.user.id, String(ctx.user.role)));

      // Always leftJoin machines (cheap, indexed FK) so the machineType filter
      // above can apply without a second query shape — same pattern as
      // aiReportGenerator.collectMachinePerformance.
      const rows = await db
        .select({
          date: dailyStatistics.date,
          total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)::int`,
          ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)::int`,
          ng: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)::int`,
          ntf: sql<number>`COALESCE(SUM(${dailyStatistics.ntfCount}), 0)::int`,
        })
        .from(dailyStatistics)
        .leftJoin(machines, eq(dailyStatistics.machineId, machines.id))
        .where(and(...conditions))
        .groupBy(dailyStatistics.date)
        .orderBy(dailyStatistics.date);

      const tsPoints: TimeSeriesPoint[] = rows.map((r) => {
        const ts = new Date(r.date).getTime();
        let value: number;
        switch (input.metric) {
          case "defect_rate":  value = r.total > 0 ? (r.ng / r.total) * 100 : 0; break;
          case "yield_rate":   value = finalYield({ ok: r.ok, ntf: r.ntf, total: r.total }); break;
          default:             value = r.total;
        }
        return { timestamp: ts, value };
      });

      /**
       * ⚠ MỘT nơi gắn nhãn cho MỌI nhánh trả về. Gắn tay ở bảy chỗ `return` là bảy bản sao, và
       * bản sao thứ tám (nhánh mới) sẽ lặng lẽ trả về một kết quả KHÔNG NÓI phạm vi của nó —
       * đúng lớp lỗi mà `withScopeLabels` được dựng ra để xoá ở các bề mặt khác.
       */
      const coNhan = <T extends object>(r: T): T & ScopeLabels => ({ ...r, ...nhan });

      if (tsPoints.length < 3) {
        // ⚠ "Insufficient data" của một phạm vi RỖNG và của một dây chuyền sạch trông GIỐNG HỆT
        // nhau — nhãn ở trên là thứ duy nhất phân biệt được hai thứ đó cho giao diện.
        return coNhan({
          summary: `Insufficient data: ${tsPoints.length} point(s) found for "${input.metric}" over ${input.period}. Need at least 3.`,
          dataPoints: tsPoints.map((p) => ({
            timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
            value: p.value,
          })),
        });
      }

      const metricLabel = input.metric.replace(/_/g, " ");

      switch (input.analysisType) {
        case "analyze": {
          const result = ewma(tsPoints, 0.3, 3.0);
          return coNhan({
            summary: `EWMA analysis · ${metricLabel} · ${input.period} · ${tsPoints.length} data points · Anomalies: ${result.anomalies.length}`,
            dataPoints: tsPoints.map((p, i) => ({
              timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
              value: p.value,
              predicted: result.smoothed[i],
              isAnomaly: result.anomalies.some((a) => a.index === i),
            })),
            anomalies: result.anomalies.map((a) => ({
              timestamp: new Date(a.timestamp).toLocaleDateString("vi-VN"),
              severity: a.score > 5 ? "high" : "medium",
              description: `Value ${a.value.toFixed(2)} (score ${a.score.toFixed(2)})`,
            })),
          });
        }

        case "forecast": {
          const horizon = Math.min(days, 14);
          const history = tsPoints.map((p) => ({
            timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
            value: p.value,
          }));
          const fp = ewmaForecast(tsPoints, 0.3, horizon);
          return coNhan({
            // doc69 A4 (audit U5) — this branch only ever calls ewmaForecast (pure
            // EWMA), never holtWinters; the summary previously claimed "Holt-Winters
            // / EWMA" regardless, mislabeling the actual algorithm used.
            summary: `EWMA forecast · ${metricLabel} · next ${horizon} periods`,
            dataPoints: [
              ...history,
              ...fp.map((f, i) => ({
                timestamp: `+${i + 1}d`,
                value: f.predicted,
                predicted: f.predicted,
              })),
            ],
          });
        }

        case "anomaly": {
          const result = ewma(tsPoints, 0.3, 2.0);
          return coNhan({
            summary: `Anomaly detection · ${metricLabel} · ${input.period} · Found: ${result.anomalies.length}`,
            dataPoints: tsPoints.map((p, i) => ({
              timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
              value: p.value,
              predicted: result.smoothed[i],
              isAnomaly: result.anomalies.some((a) => a.index === i),
            })),
            anomalies: result.anomalies.map((a) => ({
              timestamp: new Date(a.timestamp).toLocaleDateString("vi-VN"),
              severity: a.score > 4 ? "high" : "medium",
              description: `Outlier value ${a.value.toFixed(2)}, anomaly score ${a.score.toFixed(2)}`,
            })),
          });
        }

        case "decompose": {
          const period = Math.max(2, Math.min(Math.floor(tsPoints.length / 3), 7));
          const decomp = seasonalDecompose(tsPoints, period);
          return coNhan({
            summary: `Seasonal decomposition · ${metricLabel} · period=${period}`,
            dataPoints: tsPoints.map((p, i) => ({
              timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
              value: p.value,
              predicted: isNaN(decomp.trend[i]) ? p.value : decomp.trend[i],
            })),
          });
        }

        case "changepoints": {
          const cps = detectChangePoints(tsPoints, 4.0);
          const cpSet = new Set(cps.map((c) => c.index));
          return coNhan({
            summary: `Change point detection · ${metricLabel} · ${input.period} · Found: ${cps.length}`,
            dataPoints: tsPoints.map((p, i) => ({
              timestamp: new Date(p.timestamp).toLocaleDateString("vi-VN"),
              value: p.value,
              isAnomaly: cpSet.has(i),
            })),
            changePoints: cps.map((c) => ({
              timestamp: new Date(c.timestamp).toLocaleDateString("vi-VN"),
              type: c.direction,
              description: `CUSUM ${c.cumulativeSum.toFixed(2)} — ${c.direction}`,
            })),
          });
        }

        default:
          return coNhan({ summary: "Unknown analysis type", dataPoints: [] });
      }
    }),
});
