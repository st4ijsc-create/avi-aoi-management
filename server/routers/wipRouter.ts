/**
 * Sprint S1 — WIP & Line-balance Router (G5)
 *
 * Cung cấp dữ liệu đọc cho dashboard WIP realtime:
 *  - list: danh sách WIP đang chạy (lọc theo line/station/status).
 *  - summary: tổng hợp số lượng theo trạng thái (queued/in_process/blocked/starved...).
 *  - dwellByStation: tổng hợp dwell/starved/blocked theo trạm (phát hiện nút thắt).
 *  - lineBalance: chỉ số cân bằng chuyền gần nhất theo line.
 *
 * Read-only / protected. Auto-degrade về rỗng khi DB chưa sẵn sàng.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import {
  wipTracking,
  stationDwellTime,
  lineBalanceMetrics,
} from "../../drizzle/schema";
import { rankDispatch, type DispatchWipItem, type StationLoad } from "../services/dispatchingService";
import { dispatchExcludedStatuses } from "../services/wipHoldPolicy"; // W4-B: quality-hold enforcement

// Read-side filter values. Includes both the canonical enum value 'hold' and the
// legacy 'on_hold' string plus the derived 'blocked'/'starved' views the UI uses.
const wipStatusSchema = z.enum([
  "queued",
  "in_process",
  "completed",
  "blocked",
  "starved",
  "scrapped",
  "hold",
  "on_hold",
]);

export const wipRouter = router({
  // Danh sách WIP đang theo dõi, lọc tuỳ chọn theo line/station/status.
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      stationId: z.number().int().positive().optional(),
      status: wipStatusSchema.optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as (typeof wipTracking.$inferSelect)[];

      const conds = [] as any[];
      if (input?.lineId) conds.push(eq(wipTracking.lineId, input.lineId));
      if (input?.stationId) conds.push(eq(wipTracking.currentStationId, input.stationId));
      if (input?.status) conds.push(eq(wipTracking.status, input.status as any));

      const rows = await database
        .select()
        .from(wipTracking)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(wipTracking.enteredAt))
        .limit(input?.limit ?? 200);
      return rows;
    }),

  // Tổng hợp số lượng WIP theo trạng thái (cho thẻ KPI / biểu đồ tròn).
  summary: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { total: 0, byStatus: [] as { status: string; count: number }[] };

      const rows = await database
        .select({
          status: wipTracking.status,
          count: sql<number>`count(*)::int`,
        })
        .from(wipTracking)
        .where(input?.lineId ? eq(wipTracking.lineId, input.lineId) : undefined)
        .groupBy(wipTracking.status);

      const byStatus = rows.map((r) => ({ status: r.status as string, count: Number(r.count) }));
      const total = byStatus.reduce((acc, r) => acc + r.count, 0);
      return { total, byStatus };
    }),

  // Tổng hợp dwell/starved/blocked theo trạm trong khoảng thời gian (giờ).
  dwellByStation: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      hours: z.number().int().min(1).max(720).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as {
        stationId: number; avgDwellMs: number; avgStarvedMs: number; avgBlockedMs: number; samples: number;
      }[];

      const since = new Date(Date.now() - (input?.hours ?? 24) * 60 * 60 * 1000);
      const conds = [gte(stationDwellTime.enteredAt, since)];
      if (input?.lineId) conds.push(eq(stationDwellTime.lineId, input.lineId));

      const rows = await database
        .select({
          stationId: stationDwellTime.stationId,
          avgDwellMs: sql<number>`coalesce(avg(${stationDwellTime.dwellMs}),0)::int`,
          avgStarvedMs: sql<number>`coalesce(avg(${stationDwellTime.starvedMs}),0)::int`,
          avgBlockedMs: sql<number>`coalesce(avg(${stationDwellTime.blockedMs}),0)::int`,
          samples: sql<number>`count(*)::int`,
        })
        .from(stationDwellTime)
        .where(and(...conds))
        .groupBy(stationDwellTime.stationId)
        .orderBy(desc(sql`coalesce(avg(${stationDwellTime.dwellMs}),0)`));

      return rows.map((r) => ({
        stationId: r.stationId,
        avgDwellMs: Number(r.avgDwellMs),
        avgStarvedMs: Number(r.avgStarvedMs),
        avgBlockedMs: Number(r.avgBlockedMs),
        samples: Number(r.samples),
      }));
    }),

  // Chỉ số cân bằng chuyền gần nhất theo line.
  lineBalance: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive(),
      limit: z.number().int().min(1).max(200).optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as (typeof lineBalanceMetrics.$inferSelect)[];

      const rows = await database
        .select()
        .from(lineBalanceMetrics)
        .where(eq(lineBalanceMetrics.lineId, input.lineId))
        .orderBy(desc(lineBalanceMetrics.periodStart))
        .limit(input.limit ?? 24);
      return rows;
    }),

  // Điều phối realtime (B3): xếp hạng WIP nên xử lý trước dựa WIP + bottleneck.
  // Pure-compute qua dispatchingService; bottleneck lấy từ line_balance_metrics gần nhất.
  dispatch: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      max: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) {
        return { generatedAt: new Date(), bottleneckStationIds: [], totalItems: 0, recommendations: [] };
      }

      // WIP đang hoạt động (chưa hoàn tất/loại bỏ). W4-B: when WIP_HOLD_ENFORCED
      // is ON, held serials (status 'hold'/'on_hold') are ALSO excluded so a unit
      // parked for disposition is never recommended for dispatch. Default OFF =
      // prior behaviour (only completed/scrapped excluded).
      const activeConds = [
        notInArray(wipTracking.status, dispatchExcludedStatuses() as any),
      ] as any[];
      if (input?.lineId) activeConds.push(eq(wipTracking.lineId, input.lineId));

      const wipRows = await database
        .select()
        .from(wipTracking)
        .where(and(...activeConds))
        .orderBy(desc(wipTracking.enteredAt))
        .limit(500);

      // Bottleneck: lấy bản ghi cân bằng chuyền gần nhất (theo line nếu có).
      const balanceRows = await database
        .select()
        .from(lineBalanceMetrics)
        .where(input?.lineId ? eq(lineBalanceMetrics.lineId, input.lineId) : undefined)
        .orderBy(desc(lineBalanceMetrics.periodStart))
        .limit(50);

      const bottleneckIds = new Set<number>();
      for (const b of balanceRows) {
        if (b.bottleneckStationId != null) bottleneckIds.add(b.bottleneckStationId);
      }

      // Dwell gần đây (24h) để bổ sung blockedMs theo trạm.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dwellConds = [gte(stationDwellTime.enteredAt, since)] as any[];
      if (input?.lineId) dwellConds.push(eq(stationDwellTime.lineId, input.lineId));
      const dwellRows = await database
        .select({
          stationId: stationDwellTime.stationId,
          avgDwellMs: sql<number>`coalesce(avg(${stationDwellTime.dwellMs}),0)::int`,
          avgBlockedMs: sql<number>`coalesce(avg(${stationDwellTime.blockedMs}),0)::int`,
          avgStarvedMs: sql<number>`coalesce(avg(${stationDwellTime.starvedMs}),0)::int`,
        })
        .from(stationDwellTime)
        .where(and(...dwellConds))
        .groupBy(stationDwellTime.stationId);

      const stations: StationLoad[] = dwellRows.map((d) => ({
        stationId: d.stationId,
        avgDwellMs: Number(d.avgDwellMs),
        blockedMs: Number(d.avgBlockedMs),
        starvedMs: Number(d.avgStarvedMs),
        isBottleneck: bottleneckIds.has(d.stationId),
      }));
      // Đảm bảo các bottleneck không có dwell vẫn được đánh dấu.
      for (const id of bottleneckIds) {
        if (!stations.some((s) => s.stationId === id)) {
          stations.push({ stationId: id, isBottleneck: true });
        }
      }

      const items: DispatchWipItem[] = wipRows.map((w) => ({
        serialNumber: w.serialNumber,
        lotNumber: w.lotNumber,
        currentStationId: w.currentStationId,
        status: w.status as string,
        enteredAt: w.enteredAt,
      })) as any;

      return rankDispatch({ items, stations, maxRecommendations: input?.max });
    }),
});
