/**
 * P4.A G11 (extension) — IPC-A-610 acceptance router.
 *
 * Per-class verdict resolution (Class 2 = general electronics,
 * Class 3 = high-reliability automotive/aerospace/medical) on top of the
 * `defect_catalog` table.
 *
 *  - listClasses:        IPC class taxonomy.
 *  - resolveForCode:     resolve verdict for one defect code at a class.
 *  - listProfile:        list every active defect with effective verdict
 *                        for the requested class (used to render
 *                        Class 2 vs Class 3 acceptance profiles).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  IpcClass,
  listIpcClasses,
  resolveDefectForClass,
  type DefectRow,
} from "../utils/ipcAcceptance";

const classSchema = z.enum(["1", "2", "3"]);

export const ipcAcceptanceRouter = router({
  listClasses: protectedProcedure.query(() => ({
    classes: listIpcClasses(),
  })),

  resolveForCode: protectedProcedure
    .input(z.object({ code: z.string().min(1), ipcClass: classSchema }))
    .query(async ({ input }) => {
      const defect = await db.getDefectCatalogByCode(input.code);
      if (!defect) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "defectCatalogCode" }, `Defect code not found: ${input.code}`);
      }
      const resolved = resolveDefectForClass(
        defect as unknown as DefectRow,
        input.ipcClass as IpcClass,
      );
      return {
        code: defect.code,
        name: defect.name,
        category: defect.category,
        ipcReference: defect.ipcReference,
        ipcClass: input.ipcClass,
        ...resolved,
      };
    }),

  listProfile: protectedProcedure
    .input(
      z.object({
        ipcClass: classSchema,
        category: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const rows = await db.listDefectCatalog({
        category: input.category,
      });
      const items = rows.map((r) => {
        const resolved = resolveDefectForClass(
          r as unknown as DefectRow,
          input.ipcClass as IpcClass,
        );
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          nameVi: r.nameVi,
          category: r.category,
          ipcReference: r.ipcReference,
          ipcSection: r.ipcSection,
          ...resolved,
        };
      });
      return {
        ipcClass: input.ipcClass,
        total: items.length,
        rejectCount: items.filter((i) => i.accept === "reject").length,
        processCount: items.filter((i) => i.accept === "process").length,
        acceptCount: items.filter((i) => i.accept === "accept").length,
        items,
      };
    }),
});
