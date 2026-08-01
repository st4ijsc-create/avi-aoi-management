/**
 * Sprint G2.4 — BOM / Feeder / Component-genealogy tRPC router.
 *
 * SAFETY: every procedure is master-data CRUD, material telemetry, or read-only
 * trace. NOTHING here writes a command to a machine (no commandDispatcher /
 * driver.writeTags). recordComponentInstallation records an OUTCOME (telemetry)
 * and appends an EXISTING "merge" genealogy event (payload.kind=
 * "componentInstallation") — it does NOT widen the genealogy event enum.
 *
 * RBAC: module "mes_bom" (canView/Create/Edit/Delete) via requirePermission.
 *   canCreate = create BOM / line items / assign feeder
 *   canEdit   = update BOM / line items / load feeder
 *   canDelete = archive (soft-delete) BOM / delete line item
 *   canView   = list / get / trace / reorder status
 * recordComponentInstallation is a protectedProcedure (line telemetry, any
 * authenticated operator) — parallel to processResult.
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_PRODUCTION (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_PRODUCTION");
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import { getDb } from "../db/connection";
import { materials } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { recordComponentInstallation } from "../services/componentInstallationService";

const MODULE = "mes_bom";

/** Best-effort resolve a componentCode → materials.id (nullable — never throws). */
async function lookupMaterialId(code: string): Promise<number | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const [row] = await d.select({ id: materials.id }).from(materials).where(eq(materials.code, code)).limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export const bomRouter = router({
  // ─── BOM definitions ──────────────────────────────────────────────────────
  listDefinitions: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ productModelId: z.number().int().positive(), includeDeleted: z.boolean().optional() }))
    .query(({ input }) => db.listBomDefinitionsByProduct(input.productModelId, input.includeDeleted ?? false)),

  getDefinition: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const definition = await db.getBomDefinitionById(input.id);
      if (!definition) return { definition: null, lineItems: [] };
      const lineItems = await db.listBomLineItemsByBom(input.id);
      return { definition, lineItems };
    }),

  getActiveForProduct: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(({ input }) => db.getActiveBomForProduct(input.productModelId)),

  createDefinition: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      code: z.string().min(1).max(100),
      version: z.number().int().positive().optional(),
      name: z.string().max(255).optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createBomDefinition({
        productModelId: input.productModelId,
        code: input.code,
        version: input.version ?? 1,
        name: input.name ?? null,
        status: input.status ?? "draft",
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      return { id };
    }),

  updateDefinition: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().max(255).optional(),
      status: z.enum(["draft", "active", "archived"]).optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...patch } = input;
      return db.updateBomDefinition(id, patch);
    }),

  archiveDefinition: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => db.softDeleteBomDefinition(input.id)),

  // ─── BOM line items ───────────────────────────────────────────────────────
  addLineItem: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      bomId: z.number().int().positive(),
      componentCode: z.string().min(1).max(100),
      materialId: z.number().int().positive().optional(), // P2: FK -> materials.id
      componentName: z.string().max(255).optional(),
      qtyPer: z.number().positive(),
      unit: z.string().max(16).optional(),
      refDesignator: z.string().max(255).optional(),
      alternateGroup: z.string().max(64).optional(),
      isOptional: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createBomLineItem({
        bomId: input.bomId,
        componentCode: input.componentCode,
        materialId: input.materialId ?? null,
        componentName: input.componentName ?? null,
        qtyPer: String(input.qtyPer),
        unit: input.unit ?? "pcs",
        refDesignator: input.refDesignator ?? null,
        alternateGroup: input.alternateGroup ?? null,
        isOptional: input.isOptional ?? false,
        notes: input.notes ?? null,
      });
      return { id };
    }),

  bulkAddLineItems: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      bomId: z.number().int().positive(),
      items: z.array(z.object({
        componentCode: z.string().min(1).max(100),
        materialId: z.number().int().positive().optional(), // P2: FK -> materials.id
        componentName: z.string().max(255).optional(),
        qtyPer: z.number().positive(),
        unit: z.string().max(16).optional(),
        refDesignator: z.string().max(255).optional(),
        alternateGroup: z.string().max(64).optional(),
        isOptional: z.boolean().optional(),
        notes: z.string().optional(),
      })).min(1),
    }))
    .mutation(async ({ input }) => {
      const rows = await db.bulkCreateBomLineItems(input.items.map((it) => ({
        bomId: input.bomId,
        componentCode: it.componentCode,
        materialId: it.materialId ?? null,
        componentName: it.componentName ?? null,
        qtyPer: String(it.qtyPer),
        unit: it.unit ?? "pcs",
        refDesignator: it.refDesignator ?? null,
        alternateGroup: it.alternateGroup ?? null,
        isOptional: it.isOptional ?? false,
        notes: it.notes ?? null,
      })));
      return { ids: rows.map((r) => r.id), count: rows.length };
    }),

  updateLineItem: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      materialId: z.number().int().positive().nullable().optional(), // P2: FK -> materials.id
      componentName: z.string().max(255).optional(),
      qtyPer: z.number().positive().optional(),
      unit: z.string().max(16).optional(),
      refDesignator: z.string().max(255).optional(),
      alternateGroup: z.string().max(64).optional(),
      isOptional: z.boolean().optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, qtyPer, ...rest } = input;
      return db.updateBomLineItem(id, { ...rest, ...(qtyPer != null ? { qtyPer: String(qtyPer) } : {}) });
    }),

  deleteLineItem: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => db.deleteBomLineItem(input.id)),

  // ─── Feeder materials ─────────────────────────────────────────────────────
  listFeeders: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(({ input }) => db.listFeederMaterialsByMachine(input.machineId)),

  assignFeederMaterial: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      slotCode: z.string().max(40).optional(),
      componentCode: z.string().min(1).max(100),
      materialId: z.number().int().positive().optional(), // P2: FK -> materials.id
      supplierLotId: z.number().int().positive().optional(),
      qtyOnFeeder: z.number().min(0).optional(),
      consumptionRatePerHour: z.number().min(0).optional(),
      reorderLevel: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createFeederMaterial({
        machineId: input.machineId,
        slotCode: input.slotCode ?? null,
        componentCode: input.componentCode,
        materialId: input.materialId ?? null,
        supplierLotId: input.supplierLotId ?? null,
        qtyOnFeeder: String(input.qtyOnFeeder ?? 0),
        consumptionRatePerHour: input.consumptionRatePerHour != null ? String(input.consumptionRatePerHour) : null,
        reorderLevel: String(input.reorderLevel ?? 0),
        status: "active",
        loadedAt: new Date(),
        loadedBy: ctx.user.id,
      });
      return { id };
    }),

  updateFeeder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      slotCode: z.string().max(40).optional(),
      reorderLevel: z.number().min(0).optional(),
      consumptionRatePerHour: z.number().min(0).optional(),
      status: z.enum(["active", "depleted", "removed"]).optional(),
    }))
    .mutation(({ input }) => {
      const { id, reorderLevel, consumptionRatePerHour, ...rest } = input;
      return db.updateFeederMaterial(id, {
        ...rest,
        ...(reorderLevel != null ? { reorderLevel: String(reorderLevel) } : {}),
        ...(consumptionRatePerHour != null ? { consumptionRatePerHour: String(consumptionRatePerHour) } : {}),
      });
    }),

  // Re-load (top up) a feeder with a new quantity + optional supplier lot.
  loadFeeder: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      qtyOnFeeder: z.number().min(0),
      supplierLotId: z.number().int().positive().optional(),
    }))
    .mutation(({ input, ctx }) => db.updateFeederMaterial(input.id, {
      qtyOnFeeder: String(input.qtyOnFeeder),
      ...(input.supplierLotId != null ? { supplierLotId: input.supplierLotId } : {}),
      status: "active",
      loadedAt: new Date(),
      loadedBy: ctx.user.id,
    })),

  feederReorderStatus: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ machineId: z.number().int().positive().optional() }))
    .query(({ input }) => db.listFeedersBelowReorder(input.machineId)),

  // ─── Component installation (telemetry) ───────────────────────────────────
  // SAFETY: telemetry of an install OUTCOME — no machine write. Any authenticated
  // user may submit (line operator), like processResult.
  recordComponentInstallation: protectedProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(128),
      componentCode: z.string().min(1).max(100),
      componentSerial: z.string().max(128).optional(),
      supplierLotId: z.number().int().positive().optional(),
      feederMaterialId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      bomLineItemId: z.number().int().positive().optional(),
      qty: z.number().positive().optional(),
      refDesignator: z.string().max(120).optional(),
      lotCode: z.string().max(80).optional(),
    }))
    .mutation(({ input, ctx }) => recordComponentInstallation(input, ctx.user?.id ?? null)),

  // ─── Two-way trace ────────────────────────────────────────────────────────
  traceForward: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ serialNumber: z.string().min(1).max(128) }))
    .query(async ({ input }) => ({
      serialNumber: input.serialNumber,
      components: await db.listInstallationsBySerial(input.serialNumber),
    })),

  traceReverse: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      supplierLotId: z.number().int().positive().optional(),
      componentCode: z.string().min(1).max(100).optional(),
    }).refine((v) => v.supplierLotId != null || v.componentCode != null, {
      message: "Provide supplierLotId or componentCode",
    }))
    .query(async ({ input }) => {
      const installations = input.supplierLotId != null
        ? await db.listInstallationsBySupplierLot(input.supplierLotId)
        : await db.listInstallationsByComponentCode(input.componentCode!);
      return {
        supplierLotId: input.supplierLotId ?? null,
        componentCode: input.componentCode ?? null,
        serials: Array.from(new Set(installations.map((r) => r.serialNumber))),
        installations,
      };
    }),

  /**
   * Doc 54 §11 P0.5 — bulk-import BOM from a FLAT CSV/array (one row per line
   * item). Gated on the SAME permission as create (mes_bom.canCreate) — NOT
   * adminProcedure (mirrors doc-54 P0.3). Rows group by (productCode, bomCode)
   * into one BOM definition each; productCode resolves to productModelId (unknown
   * product → the whole group's rows fail). materialCode → componentCode, with a
   * best-effort materials.id link; refDes → refDesignator; qty → qtyPer.
   * Idempotent per line by (bomId, componentCode, refDesignator): existing line
   * UPDATED, new line CREATED. Counts are at the LINE level. Returns
   * {inserted, updated, failed, errors[]}.
   */
  importBom: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      rows: z.array(z.object({
        productCode: z.string().trim().min(1).max(100),
        bomCode: z.string().trim().max(100).optional(),
        bomName: z.string().max(255).optional(),
        materialCode: z.string().trim().min(1).max(100),
        componentName: z.string().max(255).optional(),
        refDes: z.string().max(255).optional(),
        qty: z.number().positive().default(1),
        unit: z.string().max(16).optional(),
        isOptional: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
      })).min(1).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = { inserted: 0, updated: 0, failed: 0, errors: [] as string[] };
      // Group flat rows by (productCode, bomCode).
      type Group = { productCode: string; bomCode: string; bomName?: string; rows: typeof input.rows };
      const groups = new Map<string, Group>();
      for (const row of input.rows) {
        const productCode = row.productCode.trim();
        const bomCode = (row.bomCode?.trim() || `${productCode}-IMPORT`);
        const key = `${productCode}::${bomCode}`;
        let g = groups.get(key);
        if (!g) {
          g = { productCode, bomCode, bomName: row.bomName, rows: [] };
          groups.set(key, g);
        }
        g.rows.push(row);
      }

      for (const g of groups.values()) {
        let bomId: number;
        let lineCache: any[];
        try {
          const product = await db.getProductModelByCode(g.productCode);
          if (!product) throw new Error(`Không tìm thấy sản phẩm "${g.productCode}"`);
          const defs = await db.listBomDefinitionsByProduct(product.id, false);
          const existingDef = defs.find((d) => d.code === g.bomCode);
          if (existingDef) {
            bomId = existingDef.id;
          } else {
            bomId = await db.createBomDefinition({
              productModelId: product.id,
              code: g.bomCode,
              version: 1,
              name: g.bomName ?? null,
              status: "draft",
              notes: null,
              createdBy: ctx.user.id,
            });
          }
          lineCache = await db.listBomLineItemsByBom(bomId);
        } catch (err) {
          // Header resolution failed → all this group's rows fail.
          result.failed += g.rows.length;
          result.errors.push(`${g.productCode}/${g.bomCode}: ${err instanceof Error ? err.message : "lỗi import"}`);
          continue;
        }

        for (const row of g.rows) {
          const componentCode = row.materialCode.trim();
          const refDesignator = row.refDes?.trim() || null;
          try {
            const materialId = await lookupMaterialId(componentCode);
            const existingLine = lineCache.find(
              (l) => l.componentCode === componentCode && (l.refDesignator ?? null) === refDesignator,
            );
            if (existingLine) {
              await db.updateBomLineItem(existingLine.id, {
                ...(materialId != null ? { materialId } : {}),
                ...(row.componentName != null ? { componentName: row.componentName } : {}),
                qtyPer: String(row.qty),
                ...(row.unit != null ? { unit: row.unit } : {}),
                ...(row.isOptional != null ? { isOptional: row.isOptional } : {}),
                ...(row.notes != null ? { notes: row.notes } : {}),
              });
              result.updated++;
            } else {
              const id = await db.createBomLineItem({
                bomId,
                componentCode,
                materialId: materialId ?? null,
                componentName: row.componentName ?? null,
                qtyPer: String(row.qty),
                unit: row.unit ?? "pcs",
                refDesignator,
                alternateGroup: null,
                isOptional: row.isOptional ?? false,
                notes: row.notes ?? null,
              });
              // Track within this batch so a duplicate row updates, not double-inserts.
              lineCache.push({ id, componentCode, refDesignator });
              result.inserted++;
            }
          } catch (err) {
            result.failed++;
            result.errors.push(`${g.productCode}/${componentCode}: ${err instanceof Error ? err.message : "lỗi import"}`);
          }
        }
      }
      return result;
    }),
});
