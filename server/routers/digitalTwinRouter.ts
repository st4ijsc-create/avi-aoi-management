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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { machines } from "../../drizzle/schema";
import { machineHealthHistory } from "../../drizzle/schema";
import { productInspections } from "../../drizzle/schema";
import { colorForTwin, simulateWhatIf } from "../services/digitalTwinService";

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
        .where(sql`${machineHealthHistory.machineId} = ANY(${machineIds})`)
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
});
