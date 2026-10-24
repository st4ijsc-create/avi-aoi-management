/**
 * Doc 35 W4-C.3 — Stencil cycle counter router.
 *
 * Endpoints:
 *   - recordPrints : accrue a batch of print cycles (+ optional clean / tension check).
 *   - status       : live worn status from read-only tools master + usage ledger.
 *   - listUsage    : recent usage log entries for a stencil.
 *
 * Recording works regardless of any flag. The worn side-effect is gated by
 * STENCIL_TRACKING_ENABLED (default OFF). The `tools` master is never written here.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { tools } from "../../drizzle/schema";
import { congMaTenant } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { idsMayTrongPhamVi } from "./_adapterPhamVi";
import { recordPrints, getStatus, listUsage } from "../services/stencilService";

export const stencilRouter = router({
  recordPrints: protectedProcedure
    .input(
      z.object({
        stencilToolId: z.number().int().positive(),
        printCount: z.number().int().min(0),
        machineId: z.number().int().positive().nullable().optional(),
        cleanedAt: z.coerce.date().nullable().optional(),
        tensionCheckAt: z.coerce.date().nullable().optional(),
        tensionValue: z.number().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return recordPrints({ ...input, recordedBy: ctx.user?.id ?? null });
    }),

  status: protectedProcedure
    .input(z.object({ stencilToolId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      // phạm vi người dùng (L6a 2026-10-25): dụng cụ theo mã nhà máy (congMaTenant) + nhật ký in theo máy (NULL = chung)
      const congTool = await congMaTenant({ factoryCode: tools.factoryCode, corporateCode: tools.corporateCode }, phamViCua(ctx));
      return getStatus(input.stencilToolId, { machineIds: await idsMayTrongPhamVi(ctx), congTool });
    }),

  listUsage: protectedProcedure
    .input(z.object({ stencilToolId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input, ctx }) => {
      const congTool = await congMaTenant({ factoryCode: tools.factoryCode, corporateCode: tools.corporateCode }, phamViCua(ctx));
      return listUsage(input.stencilToolId, input.limit, { machineIds: await idsMayTrongPhamVi(ctx), congTool }); // phạm vi người dùng (L6a 2026-10-25)
    }),
});
