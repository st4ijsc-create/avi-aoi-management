/**
 * Doc 24 / Wave-1 phase C2 — Hardware commissioning / FAT gate ADMIN router
 * (key "commissioning").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router manages the `commissioning_records` sign-off ledger ONLY. It does
 *     NOT import commandDispatcher and NEVER calls driver.writeTags — there is no
 *     code path from here that writes a value to a machine. Signing a record only
 *     RECORDS that an adapter passed its FAT/commissioning; the actual gate check
 *     lives in commandDispatcher (which re-reads the ledger before any real write).
 *   - A commissioning record is what LETS a real write happen (once
 *     OT_CONTROL_ENABLED + every existing gate also pass). Because that is a
 *     safety-critical grant, it is ADMIN-ONLY.
 * RBAC (module 'admin_system', mirrors erpAdminRouter / ecosystemAdminRouter):
 *   list → canView ; create (sign) → canCreate ; revoke → canDelete ; status → canView.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { deviceAdapters } from "../../drizzle/schema";
import {
  createRecord,
  revokeRecord,
  listRecords,
  isCommissioned,
  isCommissioningRequired,
} from "../services/ot/commissioningService";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Assert the adapter exists so we never commission a phantom id. */
async function assertAdapterExists(adapterId: number): Promise<void> {
  const d = await db();
  const [adapter] = await d.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
  if (!adapter) throw new TRPCError({ code: "NOT_FOUND", message: `Adapter #${adapterId} không tồn tại.` });
}

export const commissioningRouter = router({
  /** List the commissioning ledger for an adapter (newest first). */
  list: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ adapterId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return listRecords(input.adapterId);
    }),

  /**
   * Live gate status for an adapter: whether the C2 gate is required (flag) and
   * whether the adapter is currently commissioned. Lets an admin see WHY a real
   * write would be blocked/allowed before touching the flag.
   */
  status: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ adapterId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const commissioned = await isCommissioned(input.adapterId);
      return {
        adapterId: input.adapterId,
        required: isCommissioningRequired(),
        commissioned,
        // The effective outcome of the C2 gate for a would-be REAL write.
        wouldForceSimulated: isCommissioningRequired() && !commissioned,
      };
    }),

  /** SIGN an adapter as commissioned (create an 'active' record). Admin-only. */
  create: protectedProcedure
    .use(requirePermission("admin_system", "canCreate"))
    .input(z.object({
      adapterId: z.number().int().positive(),
      fatReference: z.string().min(1).max(255).nullable().optional(),
      /** ISO date/datetime; omit for no expiry. */
      expiresAt: z.coerce.date().nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAdapterExists(input.adapterId);
      // Guard against an already-expired expiry (would create a dead record).
      if (input.expiresAt != null && input.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "expiresAt đã ở quá khứ — bản ghi sẽ vô hiệu ngay." });
      }
      return createRecord({
        adapterId: input.adapterId,
        signedBy: ctx.user.id,
        fatReference: input.fatReference ?? null,
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      });
    }),

  /** REVOKE an active commissioning record (append-mostly; auditable). Admin-only. */
  revoke: protectedProcedure
    .use(requirePermission("admin_system", "canDelete"))
    .input(z.object({
      recordId: z.number().int().positive(),
      reason: z.string().max(2000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const row = await revokeRecord(input.recordId, ctx.user.id, input.reason ?? null);
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bản ghi commissioning không tồn tại hoặc không còn ở trạng thái 'active'.",
        });
      }
      return row;
    }),
});
