/**
 * Giai đoạn 3 — Realtime Report Router (G9 + G14)
 *
 * healthSeries: chuỗi healthScore theo máy, đã LTTB downsample về số điểm cố định.
 * enpiSummary: EnPI/năng lượng gần nhất theo máy (G14 sustainability).
 * complianceColumns: định nghĩa cột cho view tuân thủ (CFR21/IATF/ISO...).
 *
 * Read-only / protected. Auto-degrade về rỗng khi DB chưa sẵn sàng.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { asc, desc, eq, gte, and } from "drizzle-orm";
import { machineHealthHistory } from "../../drizzle/schema";
import { enpiMetrics } from "../../drizzle/schema";
import {
  lttbDownsample,
  getComplianceColumns,
  type ComplianceView,
  type TimePoint,
} from "../services/realtimeReportService";

const complianceViewSchema = z.enum([
  "CFR21_PART11",
  "IATF16949",
  "ISO9001",
  "ISO17025",
  "ISO50001",
]);

export const realtimeReportRouter = router({
  // --- G9: chuỗi healthScore đã downsample ---
  healthSeries: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      hours: z.number().int().min(1).max(2160).optional(),
      points: z.number().int().min(10).max(2000).optional(),
    }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as TimePoint[];

      const since = new Date(Date.now() - (input.hours ?? 168) * 60 * 60 * 1000);
      const rows = await database
        .select({
          timestamp: machineHealthHistory.timestamp,
          healthScore: machineHealthHistory.healthScore,
        })
        .from(machineHealthHistory)
        .where(and(
          eq(machineHealthHistory.machineId, input.machineId),
          gte(machineHealthHistory.timestamp, since),
        ))
        .orderBy(asc(machineHealthHistory.timestamp));

      const series: TimePoint[] = rows.map((r) => ({
        t: r.timestamp.getTime(),
        v: r.healthScore,
      }));

      return lttbDownsample(series, input.points ?? 300);
    }),

  // --- G14: EnPI gần nhất theo máy ---
  enpiSummary: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      return await database
        .select()
        .from(enpiMetrics)
        .where(input?.machineId ? eq(enpiMetrics.machineId, input.machineId) : undefined)
        .orderBy(desc(enpiMetrics.periodStart))
        .limit(input?.limit ?? 100);
    }),

  // --- G9: định nghĩa cột cho view tuân thủ ---
  complianceColumns: protectedProcedure
    .input(z.object({ view: complianceViewSchema }))
    .query(({ input }) => {
      return getComplianceColumns(input.view as ComplianceView);
    }),
});
