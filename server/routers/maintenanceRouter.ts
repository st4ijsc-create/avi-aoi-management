/**
 * Maintenance Work-Order CRUD router (key "maintenance") — closes the PdM loop.
 *
 * Today a work-order is created ONLY by the RCA write-tool
 * (aiLocalTools/writeHandlers/maintenance.ts) and listed read-only via
 * mesControlTowerRouter.listWorkOrders. This router adds the missing manage
 * surface: create / get / update (assign·priority·status·notes) / CLOSE /
 * delete — so a technician can actually run a work-order to completion.
 *
 * The CLOSE action is the key PdM-loop closer: it sets status=COMPLETED +
 * closedAt and derives downtimeMinutes (so computeMttrMtbf / reliability picks
 * it up → MTTR). repairStartedAt defaults to openedAt when the IN_PROGRESS
 * transition was never recorded, so MTTR never silently reads 0.
 *
 * SAFETY: pure maintenance master-data + lifecycle. NOTHING here writes a value
 * to a machine (no commandDispatcher / driver.writeTags). All writers are
 * getDb()-guarded.
 *
 * RBAC: module "machine_monitoring" (the same grant the RCA write-tool uses for
 *   create — machine_monitoring/canCreate). canView/canCreate/canEdit/canDelete
 *   via requirePermission. Admin always passes; non-admin without an explicit
 *   grant is denied (fail-safe FORBIDDEN).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { maintenanceWorkOrders, machines, sparePartsInventory } from "../../drizzle/schema";
// W4-A (doc 35) — spare-parts consumption ledger lives in its own schema file.
import { workOrderParts } from "../../drizzle/schema/maintenanceParts";

const MODULE = "machine_monitoring";

const WORK_ORDER_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const WORK_ORDER_TYPES = ["PREVENTIVE", "PREDICTIVE", "CORRECTIVE", "BREAKDOWN", "INSPECTION"] as const;

const OPEN_STATUSES = new Set(["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"]);

/** Generate a unique-enough work-order number (mirrors writeHandlers/maintenance.ts). */
function buildWorkOrderNumber(machineId: number): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${machineId}-${Date.now()}-${rand}`;
}

async function getRow(id: number) {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [row] = await db.select().from(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `work_order ${id} not found` });
  return row;
}

// Drop undefined keys so partial updates only touch provided fields.
function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const maintenanceRouter = router({
  // ── list (read) — filter by status / machine ─────────────────────────────────
  listWorkOrders: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      status: z.enum(WORK_ORDER_STATUSES).optional(),
      machineId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conds = [] as any[];
      if (input?.status) conds.push(eq(maintenanceWorkOrders.status, input.status));
      if (input?.machineId) conds.push(eq(maintenanceWorkOrders.machineId, input.machineId));
      return await db.select().from(maintenanceWorkOrders)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(maintenanceWorkOrders.openedAt))
        .limit(input?.limit ?? 200);
    }),

  // ── get one (read) ───────────────────────────────────────────────────────────
  getWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getRow(input.id)),

  // ── create (write) — reuses the writeHandlers/maintenance.ts insert pattern ───
  createWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      title: z.string().min(3).max(256),
      description: z.string().max(4000).optional(),
      type: z.enum(WORK_ORDER_TYPES).default("CORRECTIVE"),
      priority: z.number().int().min(1).max(5).default(3), // 1 = highest
      assignedTo: z.number().int().positive().nullable().optional(),
      status: z.enum(WORK_ORDER_STATUSES).default("OPEN"),
      scheduledFor: z.string().datetime().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [machine] = await db.select({ code: machines.code }).from(machines).where(eq(machines.id, input.machineId)).limit(1);
      const [row] = await db
        .insert(maintenanceWorkOrders)
        .values({
          workOrderNumber: buildWorkOrderNumber(input.machineId),
          machineId: input.machineId,
          machineCode: machine?.code ?? null,
          type: input.type,
          status: input.status,
          trigger: "MANUAL",
          priority: input.priority,
          title: input.title,
          description: input.description ?? null,
          assignedTo: input.assignedTo ?? null,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        } as any)
        .returning();
      return row;
    }),

  // ── update (write) — assign / priority / status / type / notes ────────────────
  // A transition INTO IN_PROGRESS stamps repairStartedAt (drives MTTR span).
  updateWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(3).max(256).optional(),
      description: z.string().max(4000).nullable().optional(),
      type: z.enum(WORK_ORDER_TYPES).optional(),
      priority: z.number().int().min(1).max(5).optional(),
      status: z.enum(WORK_ORDER_STATUSES).optional(),
      assignedTo: z.number().int().positive().nullable().optional(),
      resolutionNotes: z.string().max(4000).nullable().optional(),
      scheduledFor: z.string().datetime().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const existing = await getRow(input.id);

      // Stamp repairStartedAt on first transition into IN_PROGRESS.
      const startRepair =
        input.status === "IN_PROGRESS" && existing.status !== "IN_PROGRESS" && existing.repairStartedAt == null;

      const patch = clean({
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: input.status,
        assignedTo: input.assignedTo,
        resolutionNotes: input.resolutionNotes,
        scheduledFor: input.scheduledFor === undefined ? undefined : (input.scheduledFor ? new Date(input.scheduledFor) : null),
        repairStartedAt: startRepair ? new Date() : undefined,
        updatedAt: new Date(),
      });

      const [row] = await db.update(maintenanceWorkOrders).set(patch).where(eq(maintenanceWorkOrders.id, input.id)).returning();
      return row;
    }),

  // ── close (write) — THE PdM-loop closer ──────────────────────────────────────
  // Sets status=COMPLETED + closedAt and records the resolution. Computes
  // downtimeMinutes (closedAt − repairStartedAt, falling back to openedAt) so
  // reliability/computeMttrMtbf can derive MTTR. Idempotent-safe: closing an
  // already-closed order is rejected.
  closeWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      resolutionNotes: z.string().max(4000).optional(),
      downtimeMinutes: z.number().int().min(0).max(60 * 24 * 365).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const existing = await getRow(input.id);
      if (existing.status === "COMPLETED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Work order already completed" });
      }
      if (existing.status === "CANCELLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot close a cancelled work order" });
      }

      const closedAt = new Date();
      // MTTR span: prefer repairStartedAt, fall back to openedAt so the metric
      // is never silently zero when IN_PROGRESS was skipped.
      const startedAt = existing.repairStartedAt ?? existing.openedAt ?? closedAt;
      const computedDowntime = Math.max(0, Math.round((closedAt.getTime() - new Date(startedAt).getTime()) / 60000));
      const downtimeMinutes = input.downtimeMinutes ?? computedDowntime;

      const [row] = await db.update(maintenanceWorkOrders)
        .set({
          status: "COMPLETED",
          closedAt,
          repairStartedAt: existing.repairStartedAt ?? new Date(startedAt),
          downtimeMinutes,
          resolutionNotes: input.resolutionNotes ?? existing.resolutionNotes ?? null,
          updatedAt: closedAt,
        } as any)
        .where(eq(maintenanceWorkOrders.id, input.id))
        .returning();
      return row;
    }),

  // ── delete (write) ───────────────────────────────────────────────────────────
  deleteWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      await getRow(input.id); // 404 if missing
      await db.delete(maintenanceWorkOrders).where(eq(maintenanceWorkOrders.id, input.id));
      return { deleted: true, id: input.id };
    }),

  // ── status summary (read) — small badges on the list header ──────────────────
  summary: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return { total: 0, open: 0, byStatus: {} as Record<string, number> };
      const rows = await db.select().from(maintenanceWorkOrders);
      const byStatus: Record<string, number> = {};
      let open = 0;
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (OPEN_STATUSES.has(r.status)) open += 1;
      }
      return { total: rows.length, open, byStatus };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // W4-A (doc 35 §W4.2) — spare-parts consumption on a work order.
  // Closes the orphan: spare_parts_inventory had no consumption link. Recording
  // parts used inserts a work_order_parts ledger row AND decrements on-hand stock
  // atomically (single db.transaction). Below-reorder query surfaces restock need.
  // ══════════════════════════════════════════════════════════════════════════

  // ── record parts used on a WO (write) — atomic ledger insert + stock decrement ─
  recordPartsUsed: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      workOrderId: z.number().int().positive(),
      sparePartId: z.number().int().positive().optional(),
      partCode: z.string().min(1).max(64).optional(),
      quantityUsed: z.number().int().min(1).max(1_000_000),
      notes: z.string().max(2000).optional(),
    }).refine((v) => v.sparePartId != null || v.partCode != null, {
      message: "Provide sparePartId or partCode",
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");

      // Validate the work order exists (soft FK — validated here, not in DDL).
      await getRow(input.workOrderId);

      return await db.transaction(async (tx) => {
        // Resolve the spare part by id or unique partCode, locking the row so a
        // concurrent consumption cannot over-draw the same stock.
        const [part] = await tx
          .select()
          .from(sparePartsInventory)
          .where(input.sparePartId != null
            ? eq(sparePartsInventory.id, input.sparePartId)
            : eq(sparePartsInventory.partCode, input.partCode!))
          .for("update")
          .limit(1);
        if (!part) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Spare part not found" });
        }
        if (part.quantityOnHand < input.quantityUsed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient stock for ${part.partCode}: on hand ${part.quantityOnHand}, requested ${input.quantityUsed}`,
          });
        }

        // Ledger row — unitCost is snapshotted from the inventory master.
        const [row] = await tx
          .insert(workOrderParts)
          .values({
            workOrderId: input.workOrderId,
            sparePartId: part.id,
            partCode: part.partCode,
            quantityUsed: input.quantityUsed,
            unitCost: part.unitCost ?? null,
            consumedBy: ctx.user?.id ?? null,
            notes: input.notes ?? null,
          } as any)
          .returning();

        // Atomic decrement (clamped ≥ 0 defensively although validated above).
        const [updated] = await tx
          .update(sparePartsInventory)
          .set({
            quantityOnHand: sql`GREATEST(0, ${sparePartsInventory.quantityOnHand} - ${input.quantityUsed})`,
            updatedAt: new Date(),
          })
          .where(eq(sparePartsInventory.id, part.id))
          .returning({ id: sparePartsInventory.id, quantityOnHand: sparePartsInventory.quantityOnHand, reorderLevel: sparePartsInventory.reorderLevel });

        return {
          part: row,
          inventory: updated,
          belowReorder: updated ? updated.quantityOnHand <= updated.reorderLevel : false,
        };
      });
    }),

  // ── parts consumed on a WO (read) ─────────────────────────────────────────────
  listPartsForWorkOrder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ workOrderId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(workOrderParts)
        .where(eq(workOrderParts.workOrderId, input.workOrderId))
        .orderBy(desc(workOrderParts.consumedAt));
    }),

  // ── spare parts at/below reorder level (read) — restock worklist ──────────────
  partsBelowReorder: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(sparePartsInventory)
        .where(lte(sparePartsInventory.quantityOnHand, sparePartsInventory.reorderLevel))
        .orderBy(sparePartsInventory.quantityOnHand)
        .limit(input?.limit ?? 200);
    }),
});
