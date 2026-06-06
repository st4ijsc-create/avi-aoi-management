/**
 * Giai đoạn 2 — MES Control Tower Router (read-only views)
 *
 * G5 WIP & line balance: listWip, lineBalance, stationDwell
 * G6 Traceability: lotGenealogy, listDispositions
 * G7 PdM: listWorkOrders, reliability (MTTR/MTBF)
 *
 * Read-only / protected. Auto-degrades to empty arrays when tables are
 * empty (Giai đoạn 2 mới tạo schema). Không phụ thuộc hạ tầng mới.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  wipTracking,
  stationDwellTime,
  lineBalanceMetrics,
  lotDisposition,
  supplierLots,
  maintenanceWorkOrders,
} from "../../drizzle/schema";

export const mesControlTowerRouter = router({
  // --- G5: WIP units ---
  listWip: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      const conds = [] as any[];
      if (input?.lineId) conds.push(eq(wipTracking.lineId, input.lineId));
      if (input?.status) conds.push(eq(wipTracking.status, input.status as any));
      const q = database.select().from(wipTracking)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(wipTracking.enteredAt))
        .limit(input?.limit ?? 100);
      return await q;
    }),

  // --- G5: WIP count by status (for realtime board) ---
  wipSummary: protectedProcedure
    .input(z.object({ lineId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [] as { status: string; count: number }[];
      const rows = await database
        .select({ status: wipTracking.status, count: sql<number>`count(*)::int` })
        .from(wipTracking)
        .where(input?.lineId ? eq(wipTracking.lineId, input.lineId) : undefined)
        .groupBy(wipTracking.status);
      return rows as { status: string; count: number }[];
    }),

  // --- G5: line balance metrics (latest per line) ---
  lineBalance: protectedProcedure
    .input(z.object({
      lineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      return await database.select().from(lineBalanceMetrics)
        .where(input?.lineId ? eq(lineBalanceMetrics.lineId, input.lineId) : undefined)
        .orderBy(desc(lineBalanceMetrics.periodStart))
        .limit(input?.limit ?? 50);
    }),

  // --- G5: station dwell incl starved/blocked ---
  stationDwell: protectedProcedure
    .input(z.object({
      stationId: z.number().int().positive().optional(),
      sinceHours: z.number().int().min(1).max(24 * 30).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      const conds = [] as any[];
      if (input?.stationId) conds.push(eq(stationDwellTime.stationId, input.stationId));
      if (input?.sinceHours) {
        const since = new Date(Date.now() - input.sinceHours * 3600 * 1000);
        conds.push(gte(stationDwellTime.enteredAt, since));
      }
      return await database.select().from(stationDwellTime)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(stationDwellTime.enteredAt))
        .limit(input?.limit ?? 200);
    }),

  // --- G6: lot genealogy (2-way) ---
  lotGenealogy: protectedProcedure
    .input(z.object({ lotNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { lot: input.lotNumber, supplierLots: [], dispositions: [], wipUnits: [] };
      const [dispositions, wipUnits] = await Promise.all([
        database.select().from(lotDisposition).where(eq(lotDisposition.lotNumber, input.lotNumber)),
        database.select().from(wipTracking).where(eq(wipTracking.lotNumber, input.lotNumber)),
      ]);
      const supplierLotIds = [...new Set(dispositions.map((d) => d.supplierLotId).filter((x): x is number => x != null))];
      const supplierLotRows = supplierLotIds.length
        ? await database.select().from(supplierLots).where(sql`${supplierLots.id} in (${sql.join(supplierLotIds, sql`, `)})`)
        : [];
      return { lot: input.lotNumber, supplierLots: supplierLotRows, dispositions, wipUnits };
    }),

  // --- G6: dispositions list ---
  listDispositions: protectedProcedure
    .input(z.object({
      disposition: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      return await database.select().from(lotDisposition)
        .where(input?.disposition ? eq(lotDisposition.disposition, input.disposition as any) : undefined)
        .orderBy(desc(lotDisposition.decidedAt))
        .limit(input?.limit ?? 100);
    }),

  // --- G7: maintenance work orders ---
  listWorkOrders: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      const conds = [] as any[];
      if (input?.status) conds.push(eq(maintenanceWorkOrders.status, input.status as any));
      if (input?.machineId) conds.push(eq(maintenanceWorkOrders.machineId, input.machineId));
      return await database.select().from(maintenanceWorkOrders)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(maintenanceWorkOrders.openedAt))
        .limit(input?.limit ?? 100);
    }),

  // --- G7: work-order status summary ---
  workOrderSummary: protectedProcedure
    .query(async () => {
      const database = await getDb();
      if (!database) return [] as { status: string; count: number }[];
      const rows = await database
        .select({ status: maintenanceWorkOrders.status, count: sql<number>`count(*)::int` })
        .from(maintenanceWorkOrders)
        .groupBy(maintenanceWorkOrders.status);
      return rows as { status: string; count: number }[];
    }),

  // --- G7: MTTR/MTBF reliability ---
  reliability: protectedProcedure
    .input(z.object({
      machineId: z.number().int().positive(),
      sinceDays: z.number().int().min(1).max(365).optional(),
    }))
    .query(async ({ input }) => {
      const { computeMttrMtbf } = await import("../services/pdmWorkOrderService");
      const days = input.sinceDays ?? 90;
      const from = new Date(Date.now() - days * 24 * 3600 * 1000);
      return computeMttrMtbf(input.machineId, from, new Date());
    }),
});
