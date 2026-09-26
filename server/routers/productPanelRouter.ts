/**
 * Product Panel multi-up router (key "productPanel") — doc 29 §2 (W8-B, 0192).
 *
 * CRUD over product_panel_defs / product_panel_boards + the pure rows×cols
 * quick-generate used by the panel editor on the ProductModels page. Master
 * data only: NOTHING here writes to a machine.
 *
 * RBAC: module "settings_products" — the panel def is part of the product
 * master (same permission the point editor / program-release panel use).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import {
  listPanelDefs,
  getPanelDef,
  getActivePanelDefForProduct,
  createPanelDef,
  updatePanelDef,
  softDeletePanelDef,
  replaceBoards,
} from "../services/panel/panelService";
import { generateGridBoards } from "../services/panel/panelTransform";

const MODULE = "settings_products";

const boardInputSchema = z.object({
  boardIndex: z.number().int().min(1),
  offsetXMm: z.number().finite(),
  offsetYMm: z.number().finite(),
  rotationDeg: z.number().finite().optional(),
  mirrored: z.boolean().optional(),
  skipped: z.boolean().optional(),
  refDesPrefix: z.string().max(20).nullish(),
});

const panelDefFields = {
  code: z.string().trim().min(1).max(60),
  name: z.string().max(255).nullish(),
  rows: z.number().int().min(1).max(64).optional(),
  cols: z.number().int().min(1).max(64).optional(),
  nUp: z.number().int().min(1).max(4096).optional(),
  panelWidthMm: z.number().positive().nullish(),
  panelHeightMm: z.number().positive().nullish(),
  boardWidthMm: z.number().positive().nullish(),
  boardHeightMm: z.number().positive().nullish(),
  originCorner: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).optional(),
  serialScheme: z.enum(["suffix", "range", "barcode_per_board"]).optional(),
  fiducials: z.array(z.object({ x: z.number(), y: z.number(), type: z.string().max(40).optional() })).nullish(),
  isActive: z.boolean().optional(),
};

export const productPanelRouter = router({
  /** All (non-deleted) panel defs of a product, boards included. */
  listByProduct: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(({ input }) => listPanelDefs(input.productModelId)),

  get: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const def = await getPanelDef(input.id);
      if (!def) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "panelDefinition" }, "Panel definition not found");
      return def;
    }),

  /**
   * The ACTIVE panel def of a product or null (single-board product). Used by
   * the InspectionDetail "Board i/n" chip and analytics — null must be handled
   * honestly by callers (no panel = no panel-aware view).
   */
  getActive: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(({ input }) => getActivePanelDefForProduct(input.productModelId)),

  /** Pure rows×cols quick-generate preview (no write) for the editor. */
  generateGrid: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      rows: z.number().int().min(1).max(64),
      cols: z.number().int().min(1).max(64),
      panelWidthMm: z.number().positive().nullish(),
      panelHeightMm: z.number().positive().nullish(),
      boardWidthMm: z.number().positive().nullish(),
      boardHeightMm: z.number().positive().nullish(),
    }))
    .query(({ input }) => generateGridBoards(input)),

  create: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      productModelId: z.number().int().positive(),
      ...panelDefFields,
      boards: z.array(boardInputSchema).max(4096).optional(),
    }))
    .mutation(async ({ input }) => {
      const product = await db.getProductModelById(input.productModelId);
      if (!product) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productModel" }, "Product model not found");
      const { boards, ...def } = input;
      try {
        const id = await createPanelDef(def, boards);
        return { id };
      } catch (err) {
        throw appError(
          "BAD_REQUEST",
          "OPERATION_FAILED",
          { operation: "createPanelDefinition" },
          err instanceof Error ? err.message : "Failed to create panel definition",
        );
      }
    }),

  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      code: panelDefFields.code.optional(),
      name: panelDefFields.name,
      rows: panelDefFields.rows,
      cols: panelDefFields.cols,
      nUp: panelDefFields.nUp,
      panelWidthMm: panelDefFields.panelWidthMm,
      panelHeightMm: panelDefFields.panelHeightMm,
      boardWidthMm: panelDefFields.boardWidthMm,
      boardHeightMm: panelDefFields.boardHeightMm,
      originCorner: panelDefFields.originCorner,
      serialScheme: panelDefFields.serialScheme,
      fiducials: panelDefFields.fiducials,
      isActive: panelDefFields.isActive,
    }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const row = await updatePanelDef(id, patch);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "panelDefinition" }, "Panel definition not found");
      return row;
    }),

  remove: protectedProcedure
    .use(requirePermission(MODULE, "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => softDeletePanelDef(input.id)),

  /** Replace the FULL board table of a panel def (editor save). */
  saveBoards: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      panelDefId: z.number().int().positive(),
      boards: z.array(boardInputSchema).min(1).max(4096),
    }))
    .mutation(async ({ input }) => {
      try {
        return await replaceBoards(input.panelDefId, input.boards);
      } catch (err) {
        throw appError(
          "BAD_REQUEST",
          "OPERATION_FAILED",
          { operation: "savePanelBoards" },
          err instanceof Error ? err.message : "Failed to save boards",
        );
      }
    }),
});

export type ProductPanelRouter = typeof productPanelRouter;
