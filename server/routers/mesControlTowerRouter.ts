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
import { appError } from "../_core/appError";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { createNcr } from "../services/ncrService"; // W4-B: optional lot-disposition → NCR link
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  wipTracking,
  stationDwellTime,
  lineBalanceMetrics,
  lotDisposition,
  supplierLots,
  materialReceipts,
  maintenanceWorkOrders,
  suppliers,
  materials,
  productionLines,
  stations,
  machines,
} from "../../drizzle/schema";

// P2: resolve a master id from a free-text code so write UIs can pass either an
// explicit FK id or just the code (id wins; otherwise we look up by code).
async function resolveSupplierId(database: any, id?: number | null, code?: string | null): Promise<number | null> {
  if (id != null) return id;
  if (!code) return null;
  const [row] = await database.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.code, code)).limit(1);
  return row?.id ?? null;
}
async function resolveMaterialId(database: any, id?: number | null, code?: string | null): Promise<number | null> {
  if (id != null) return id;
  if (!code) return null;
  const [row] = await database.select({ id: materials.id }).from(materials).where(eq(materials.code, code)).limit(1);
  return row?.id ?? null;
}

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

  // --- P3: id→name lookup for lines/stations/machines so the hub shows real
  // hierarchy names instead of raw numeric ids ("St #5"). One small payload that
  // the client turns into Maps; avoids N per-row joins. ---
  nameLookup: protectedProcedure.query(async () => {
    const database = await getDb();
    if (!database) return { lines: [], stations: [], machines: [] };
    const [lineRows, stationRows, machineRows] = await Promise.all([
      database.select({ id: productionLines.id, code: productionLines.code, name: productionLines.name }).from(productionLines),
      database.select({ id: stations.id, code: stations.code, name: stations.name, lineId: stations.lineId }).from(stations),
      database.select({ id: machines.id, code: machines.code, name: machines.name }).from(machines),
    ]);
    return { lines: lineRows, stations: stationRows, machines: machineRows };
  }),

  // --- P3: single-serial trace drill — full picture for ONE serial number:
  // its WIP history rows, the lot dispositions on its lot, parent/child
  // genealogy serials, and any dwell rows recorded for it. ---
  serialTrace: protectedProcedure
    .input(z.object({ serialNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const database = await getDb();
      const empty = {
        serialNumber: input.serialNumber,
        wipUnits: [] as any[],
        dwell: [] as any[],
        dispositions: [] as any[],
        children: [] as any[],
        lotNumbers: [] as string[],
        parentSerialNumber: null as string | null,
      };
      if (!database) return empty;
      const sn = input.serialNumber;
      const [wipUnits, dwell, children] = await Promise.all([
        database.select().from(wipTracking)
          .where(eq(wipTracking.serialNumber, sn))
          .orderBy(desc(wipTracking.enteredAt)),
        database.select().from(stationDwellTime)
          .where(eq(stationDwellTime.serialNumber, sn))
          .orderBy(desc(stationDwellTime.enteredAt)),
        // genealogy downstream: units whose parent is this serial
        database.select().from(wipTracking)
          .where(eq(wipTracking.parentSerialNumber, sn))
          .orderBy(desc(wipTracking.enteredAt)),
      ]);
      const lotNumbers = [...new Set(wipUnits.map((w) => w.lotNumber).filter((x): x is string => !!x))];
      const dispositions = lotNumbers.length
        ? await database.select().from(lotDisposition)
            .where(sql`(${lotDisposition.serialNumber} = ${sn} or ${lotDisposition.lotNumber} in (${sql.join(lotNumbers, sql`, `)}))`)
            .orderBy(desc(lotDisposition.decidedAt))
        : await database.select().from(lotDisposition)
            .where(eq(lotDisposition.serialNumber, sn))
            .orderBy(desc(lotDisposition.decidedAt));
      const parentSerialNumber = wipUnits.find((w) => w.parentSerialNumber)?.parentSerialNumber ?? null;
      return { serialNumber: sn, wipUnits, dwell, dispositions, children, lotNumbers, parentSerialNumber };
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

  // ==========================================================================
  // P2 — Write paths for the previously-unwritable material-flow shells.
  // These let the Control Tower create real rows (material receipts / supplier
  // lots / lot dispositions) wired to the master-data FKs (supplierId/materialId).
  // ==========================================================================

  // --- G6: material receipts (list + create) ---
  listMaterialReceipts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      return database.select().from(materialReceipts)
        .orderBy(desc(materialReceipts.receivedDate))
        .limit(input?.limit ?? 100);
    }),
  createMaterialReceipt: protectedProcedure
    .input(z.object({
      receiptNumber: z.string().min(1).max(64),
      supplierId: z.number().int().positive().optional(),
      supplierCode: z.string().max(64).optional(),
      supplierName: z.string().max(256).optional(),
      materialId: z.number().int().positive().optional(),
      materialCode: z.string().min(1).max(64),
      materialName: z.string().max(256).optional(),
      quantity: z.number().positive(),
      unit: z.string().max(16).optional(),
      poNumber: z.string().max(64).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const supplierId = await resolveSupplierId(database, input.supplierId, input.supplierCode);
      const materialId = await resolveMaterialId(database, input.materialId, input.materialCode);
      const [row] = await database.insert(materialReceipts).values({
        receiptNumber: input.receiptNumber,
        supplierId,
        supplierCode: input.supplierCode ?? null,
        supplierName: input.supplierName ?? null,
        materialId,
        materialCode: input.materialCode,
        materialName: input.materialName ?? null,
        quantity: String(input.quantity),
        unit: input.unit ?? "pcs",
        poNumber: input.poNumber ?? null,
        notes: input.notes ?? null,
      }).returning({ id: materialReceipts.id });
      return { id: row.id };
    }),

  // --- G6: supplier lots (list + create) ---
  listSupplierLots: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return [];
      return database.select().from(supplierLots)
        .orderBy(desc(supplierLots.createdAt))
        .limit(input?.limit ?? 100);
    }),
  createSupplierLot: protectedProcedure
    .input(z.object({
      supplierLotNumber: z.string().min(1).max(128),
      receiptId: z.number().int().positive().optional(),
      materialId: z.number().int().positive().optional(),
      materialCode: z.string().min(1).max(64),
      materialName: z.string().max(256).optional(),
      quantity: z.number().positive(),
      unit: z.string().max(16).optional(),
      status: z.enum(["received", "inspecting", "approved", "rejected", "consumed", "returned"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const materialId = await resolveMaterialId(database, input.materialId, input.materialCode);
      const [row] = await database.insert(supplierLots).values({
        supplierLotNumber: input.supplierLotNumber,
        receiptId: input.receiptId ?? null,
        materialId,
        materialCode: input.materialCode,
        materialName: input.materialName ?? null,
        quantity: String(input.quantity),
        remainingQuantity: String(input.quantity),
        unit: input.unit ?? "pcs",
        status: (input.status ?? "received") as any,
      }).returning({ id: supplierLots.id });
      return { id: row.id };
    }),

  // --- G6: lot disposition (create) ---
  createLotDisposition: protectedProcedure
    .input(z.object({
      lotNumber: z.string().min(1).max(128),
      supplierLotId: z.number().int().positive().optional(),
      serialNumber: z.string().max(128).optional(),
      disposition: z.enum(["release", "rework", "scrap", "return", "hold", "quarantine"]),
      quantity: z.number().positive(),
      reason: z.string().optional(),
      defectCode: z.string().max(64).optional(),
      // W4-B — optionally raise a linked NCR/MRB for this lot (typically for
      // scrap/return/quarantine). Additive & opt-in: default false = prior behaviour.
      raiseNcr: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [row] = await database.insert(lotDisposition).values({
        lotNumber: input.lotNumber,
        supplierLotId: input.supplierLotId ?? null,
        serialNumber: input.serialNumber ?? null,
        disposition: input.disposition as any,
        quantity: String(input.quantity),
        reason: input.reason ?? null,
        defectCode: input.defectCode ?? null,
        decidedBy: ctx.user?.id ?? null,
      }).returning({ id: lotDisposition.id });

      // Optional lot → NCR link. Fail-soft: an NCR-create issue must never fail
      // the disposition write that already committed.
      let ncrId: number | null = null;
      if (input.raiseNcr) {
        try {
          const ncr = await createNcr({
            source: "lot",
            raisedBy: ctx.user?.id ?? 0,
            lotNumber: input.lotNumber,
            serialNumber: input.serialNumber ?? null,
            defectSummary: input.defectCode ? `Defect ${input.defectCode}` : null,
            reason: `Lot disposition '${input.disposition}': ${input.reason ?? ""}`.trim(),
          });
          ncrId = ncr.id;
        } catch (err) {
          console.error("[mesControlTower] raiseNcr failed (suppressed):", (err as any)?.message ?? err);
        }
      }
      return { id: row.id, ncrId };
    }),
});
