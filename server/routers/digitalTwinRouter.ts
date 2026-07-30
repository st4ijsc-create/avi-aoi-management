/**
 * Giai đoạn 3 — Digital Twin Router (G10, read-only)
 *
 * twinState: máy + health gần nhất + màu twin + vị trí layout.
 * defectHeatmap: gom số NG theo máy trong cửa sổ thời gian (cho lớp nhiệt 2D/3D).
 * whatIf: mô phỏng năng suất chuyền (pure compute, không ghi DB).
 *
 * Read-only / protected. Auto-degrade về mảng rỗng khi DB chưa sẵn sàng.
 * Không phụ thuộc hạ tầng mới.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { machines } from "../../drizzle/schema";
import { machineHealthHistory } from "../../drizzle/schema";
import { productInspections } from "../../drizzle/schema";
import {
  colorForTwin,
  simulateWhatIf,
  stationLoadHeatmap,
  buildPredictionOverlay,
  type StationLoadInput,
  type StationForecast,
} from "../services/digitalTwinService";
import { getWipByStation, getWipCountSeries } from "../db/twin";
import { getStationDwellAgg, getLatestLineBalance } from "../db/lineBalance";
import { getMachinePositionsByLayout } from "../db/layout";
import { forecastWithConfidenceInterval, type TimeSeriesPoint } from "../services/aiTimeSeriesEngine";

export const digitalTwinRouter = router({
  // --- G10: trạng thái twin của toàn bộ máy (hoặc theo station) ---
  twinState: protectedProcedure
    .input(z.object({
      stationId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as any[];

      const rows = await database
        .select()
        .from(machines)
        .where(input?.stationId ? eq(machines.stationId, input.stationId) : undefined)
        .limit(input?.limit ?? 500);

      if (rows.length === 0) return [];

      // Health gần nhất theo máy (1 query, lấy bản ghi mới nhất mỗi máy ở app-layer)
      const machineIds = rows.map((m) => m.id);
      const healthRows = await database
        .select({
          machineId: machineHealthHistory.machineId,
          healthScore: machineHealthHistory.healthScore,
          predictedFailureRisk: machineHealthHistory.predictedFailureRisk,
          timestamp: machineHealthHistory.timestamp,
        })
        .from(machineHealthHistory)
        // inArray → "machineId" in ($1,$2,…). NB: a raw `= ANY(${machineIds})` compiles to
        // `= ANY(($1,$2,…))` — a Postgres row-constructor, not an array — which fails with
        // SQLSTATE 42809 "op ANY/ALL (array) requires array on right side".
        .where(inArray(machineHealthHistory.machineId, machineIds))
        .orderBy(desc(machineHealthHistory.timestamp));

      const latestHealth = new Map<number, { healthScore: number; predictedFailureRisk: number | null }>();
      for (const h of healthRows) {
        if (!latestHealth.has(h.machineId)) {
          latestHealth.set(h.machineId, {
            healthScore: h.healthScore,
            predictedFailureRisk: h.predictedFailureRisk,
          });
        }
      }

      return rows.map((m) => {
        const h = latestHealth.get(m.id) ?? null;
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          stationId: m.stationId,
          operationStatus: m.operationStatus,
          image2DUrl: m.image2DUrl,
          image3DUrl: m.image3DUrl,
          layoutPositionX: m.layoutPositionX,
          layoutPositionY: m.layoutPositionY,
          healthScore: h?.healthScore ?? null,
          predictedFailureRisk: h?.predictedFailureRisk ?? null,
          color: colorForTwin(m.operationStatus, h?.healthScore ?? null),
        };
      });
    }),

  // --- G10: heatmap defect (số NG theo máy trong cửa sổ thời gian) ---
  defectHeatmap: protectedProcedure
    .input(z.object({
      hours: z.number().int().min(1).max(720).optional(),
      stationId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as { machineId: number; ngCount: number; totalCount: number; ngRate: number }[];

      const since = new Date(Date.now() - (input?.hours ?? 24) * 60 * 60 * 1000);

      const rows = await database
        .select({
          machineId: productInspections.machineId,
          ngCount: sql<number>`count(*) FILTER (WHERE ${productInspections.overallResult} = 'NG')::int`,
          totalCount: sql<number>`count(*)::int`,
        })
        .from(productInspections)
        .where(gte(productInspections.inspectionTime, since))
        .groupBy(productInspections.machineId);

      return rows.map((r) => ({
        machineId: r.machineId,
        ngCount: r.ngCount,
        totalCount: r.totalCount,
        ngRate: r.totalCount > 0 ? Math.round((r.ngCount / r.totalCount) * 1000) / 10 : 0,
      }));
    }),

  // --- G10: mô phỏng what-if năng suất chuyền (pure compute) ---
  whatIf: protectedProcedure
    .input(z.object({
      stations: z.array(z.object({
        stationId: z.number().int(),
        name: z.string().nullish(),
        cycleTimeSec: z.number().positive(),
        availability: z.number().min(0).max(1).optional(),
        yield: z.number().min(0).max(1).optional(),
      })).min(1),
      horizonHours: z.number().positive().max(720),
      cycleTimeMultiplier: z.number().positive().max(10).optional(),
    }))
    .query(async ({ input }) => {
      return simulateWhatIf(input);
    }),

  // --- G2.7: WIP flow theo station (read-only) ---
  // Trả số WIP đang trong chuyền + serials theo station, join vị trí layout (nếu có).
  wipFlowState: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      layoutId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await getWipByStation({ lineId: input?.lineId });
      // DB đã GROUP BY + loại exited (exitedAt IS NULL) ở SQL → count/serials thực.
      const byStation = new Map<number, { count: number; serials: string[] }>();
      for (const r of rows) byStation.set(r.currentStationId, { count: r.count, serials: r.serials });

      // Vị trí station (best-effort) từ layout — read-only, optional.
      const posByStation = new Map<number, { x: number; y: number }>();
      if (input?.layoutId != null) {
        const positions = await getMachinePositionsByLayout(input.layoutId);
        for (const p of positions as any[]) {
          const sid = (p.station?.id ?? p.stationId) as number | undefined;
          if (sid != null && !posByStation.has(sid) && p.positionX != null && p.positionY != null) {
            posByStation.set(sid, { x: Number(p.positionX), y: Number(p.positionY) });
          }
        }
      }

      const stations = Array.from(byStation.entries()).map(([stationId, v]) => ({
        stationId,
        wipCount: v.count,
        serials: v.serials,
        position: posByStation.get(stationId) ?? null,
      }));

      return {
        stations,
        totalWip: stations.reduce((a, s) => a + s.wipCount, 0),
        stationCount: stations.length,
        ts: Date.now(),
      };
    }),

  // --- G2.7: heatmap tải trạm (read-only) ---
  stationLoadHeatmap: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
      hours: z.number().int().min(1).max(720).optional(),
    }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - (input.hours ?? 24) * 60 * 60 * 1000);
      const [dwellAgg, latest] = await Promise.all([
        getStationDwellAgg(input.lineId, since),
        getLatestLineBalance(input.lineId),
      ]);
      // utilization toàn chuyền (nếu có) dùng làm fallback cho mọi trạm thiếu dwell.
      const lineUtil = latest?.utilizationPct ?? null;
      const inputs: StationLoadInput[] = dwellAgg.map((d) => ({
        stationId: d.stationId,
        avgDwellMs: d.avgDwellMs,
        avgStarvedMs: d.avgStarvedMs,
        avgBlockedMs: d.avgBlockedMs,
        utilizationPct: d.avgDwellMs > 0 ? null : lineUtil,
        samples: d.samples,
      }));
      return {
        cells: stationLoadHeatmap(inputs),
        bottleneckStationId: latest?.bottleneckStationId ?? null,
        ts: Date.now(),
      };
    }),

  // --- G2.7: overlay dự báo tắc nghẽn (read-only, text+màu only) ---
  predictionOverlay: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
      horizonHours: z.number().int().min(1).max(24).optional(),
      algorithm: z.enum(["ewma", "holt_winters"]).optional(),
      bucketMin: z.number().int().min(1).max(240).optional(),
      threshold: z.number().positive().max(100000).optional(),
    }))
    .query(async ({ input }) => {
      const bucketMin = input.bucketMin ?? 30;
      const lookbackHours = 24;
      const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const series = await getWipCountSeries(input.lineId, since, bucketMin);

      // <3 điểm → không đủ dữ liệu để dự báo: trả available:false, KHÔNG throw.
      if (series.length < 3) {
        return { available: false as const, reason: "insufficient_data", cells: [], ts: Date.now() };
      }

      const points: TimeSeriesPoint[] = series.map((b) => ({
        timestamp: new Date(b.bucketStart).getTime(),
        value: b.wipCount,
      }));
      const bucketsPerHour = Math.max(1, Math.round(60 / bucketMin));
      const horizon = Math.max(1, (input.horizonHours ?? 1) * bucketsPerHour);
      const forecast = forecastWithConfidenceInterval(points, horizon, input.algorithm ?? "ewma");
      // WIP dự báo "1h tới" = trung bình các bucket trong giờ đầu của horizon.
      const next1h = forecast.slice(0, bucketsPerHour);
      const predictedWipNext1h = next1h.length
        ? next1h.reduce((a, p) => a + Math.max(0, p.predicted), 0) / next1h.length
        : 0;

      // Ngưỡng mặc định: 1.5× WIP đỉnh lịch sử (nếu không truyền threshold).
      const histMax = points.reduce((m, p) => Math.max(m, p.value), 0);
      const threshold = input.threshold ?? Math.max(1, histMax * 1.5);

      const forecasts: StationForecast[] = [{ stationId: input.lineId, predictedWipNext1h }];
      const overlay = buildPredictionOverlay(forecasts, threshold);
      return {
        available: true as const,
        threshold,
        cells: overlay,
        ts: Date.now(),
      };
    }),
});
