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
import { recordComponentInstallation } from "../services/componentInstallationService";

const MODULE = "mes_bom";

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
});
